//go:build windows

package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"
)

const (
	appVersion       = "1.1.10"
	vercelCLIVersion = "59.16.0"

	WM_DESTROY = 0x0002
	WM_CLOSE   = 0x0010
	WM_COMMAND = 0x0111
	WM_SETFONT = 0x0030
	WM_APP_UI  = 0x8001

	EM_SETSEL      = 0x00B1
	EM_REPLACESEL  = 0x00C2
	EM_SETREADONLY = 0x00CF

	LB_RESETCONTENT = 0x0184
	LB_ADDSTRING    = 0x0180
	LB_SETCURSEL    = 0x0186

	WS_OVERLAPPED  = 0x00000000
	WS_CAPTION     = 0x00C00000
	WS_SYSMENU     = 0x00080000
	WS_THICKFRAME  = 0x00040000
	WS_MINIMIZEBOX = 0x00020000
	WS_MAXIMIZEBOX = 0x00010000
	WS_VISIBLE     = 0x10000000
	WS_CHILD       = 0x40000000
	WS_BORDER      = 0x00800000
	WS_VSCROLL     = 0x00200000
	WS_HSCROLL     = 0x00100000
	WS_TABSTOP     = 0x00010000

	ES_LEFT        = 0x0000
	ES_MULTILINE   = 0x0004
	ES_AUTOVSCROLL = 0x0040
	ES_AUTOHSCROLL = 0x0080
	ES_READONLY    = 0x0800

	LBS_NOTIFY           = 0x0001
	LBS_NOINTEGRALHEIGHT = 0x0100

	BS_PUSHBUTTON    = 0x00000000
	BS_DEFPUSHBUTTON = 0x00000001

	SW_SHOW       = 5
	SW_SHOWNORMAL = 1

	MB_OK              = 0x00000000
	MB_ICONINFORMATION = 0x00000040
	MB_ICONWARNING     = 0x00000030
	MB_ICONERROR       = 0x00000010
	MB_YESNO           = 0x00000004
	IDYES              = 6

	CF_TEXT        = 1
	CF_UNICODETEXT = 13

	CRYPTPROTECT_UI_FORBIDDEN = 0x1

	CTRL_START         = 1001
	CTRL_STOP          = 1002
	CTRL_OPEN_SITE     = 1003
	CTRL_OPEN_CORE     = 1004
	CTRL_TAMPER        = 1005
	CTRL_EXTENSION     = 1006
	CTRL_CF_SIGNUP     = 1007
	CTRL_VERCEL_SIGNUP = 1008
	CTRL_TURSO_SIGNUP  = 1009

	CTRL_CF_PROJECT     = 1101
	CTRL_SITE_URL       = 1102
	CTRL_VERCEL_PROJECT = 1103
	CTRL_CORE_URL       = 1104
	CTRL_TURSO_DB       = 1105
	CTRL_TURSO_URL      = 1106
	CTRL_TURSO_TOKEN    = 1107
	CTRL_CORE_KEY       = 1108
	CTRL_ROOT           = 1109

	CTRL_COPY_BASE = 1200
)

var (
	user32   = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")
	shell32  = syscall.NewLazyDLL("shell32.dll")
	gdi32    = syscall.NewLazyDLL("gdi32.dll")
	crypt32  = syscall.NewLazyDLL("crypt32.dll")

	procRegisterClassExW = user32.NewProc("RegisterClassExW")
	procCreateWindowExW  = user32.NewProc("CreateWindowExW")
	procDefWindowProcW   = user32.NewProc("DefWindowProcW")
	procShowWindow       = user32.NewProc("ShowWindow")
	procUpdateWindow     = user32.NewProc("UpdateWindow")
	procGetMessageW      = user32.NewProc("GetMessageW")
	procTranslateMessage = user32.NewProc("TranslateMessage")
	procDispatchMessageW = user32.NewProc("DispatchMessageW")
	procPostQuitMessage  = user32.NewProc("PostQuitMessage")
	procPostMessageW     = user32.NewProc("PostMessageW")
	procSendMessageW     = user32.NewProc("SendMessageW")
	procSetWindowTextW   = user32.NewProc("SetWindowTextW")
	procGetWindowTextW   = user32.NewProc("GetWindowTextW")
	procGetWindowTextLen = user32.NewProc("GetWindowTextLengthW")
	procMessageBoxW      = user32.NewProc("MessageBoxW")
	procEnableWindow     = user32.NewProc("EnableWindow")
	procOpenClipboard    = user32.NewProc("OpenClipboard")
	procEmptyClipboard   = user32.NewProc("EmptyClipboard")
	procSetClipboardData = user32.NewProc("SetClipboardData")
	procGetClipboardData = user32.NewProc("GetClipboardData")
	procCloseClipboard   = user32.NewProc("CloseClipboard")

	procGetModuleHandleW = kernel32.NewProc("GetModuleHandleW")
	procGlobalAlloc      = kernel32.NewProc("GlobalAlloc")
	procGlobalLock       = kernel32.NewProc("GlobalLock")
	procGlobalUnlock     = kernel32.NewProc("GlobalUnlock")
	procLocalFree        = kernel32.NewProc("LocalFree")

	procShellExecuteW = shell32.NewProc("ShellExecuteW")
	procCreateFontW   = gdi32.NewProc("CreateFontW")

	procCryptProtectData   = crypt32.NewProc("CryptProtectData")
	procCryptUnprotectData = crypt32.NewProc("CryptUnprotectData")
)

type point struct{ X, Y int32 }
type msg struct {
	Hwnd     uintptr
	Message  uint32
	WParam   uintptr
	LParam   uintptr
	Time     uint32
	Pt       point
	LPrivate uint32
}

type wndClassEx struct {
	CbSize        uint32
	Style         uint32
	LpfnWndProc   uintptr
	CbClsExtra    int32
	CbWndExtra    int32
	HInstance     uintptr
	HIcon         uintptr
	HCursor       uintptr
	HbrBackground uintptr
	LpszMenuName  *uint16
	LpszClassName *uint16
	HIconSm       uintptr
}

type dataBlob struct {
	cbData uint32
	pbData *byte
}

type stateFile struct {
	Version                 int    `json:"version"`
	ProjectName             string `json:"projectName,omitempty"`
	Step                    int    `json:"step"`
	CloudflareProject       string `json:"cloudflareProject"`
	CloudflareAccount       string `json:"cloudflareAccount,omitempty"`
	VercelProject           string `json:"vercelProject"`
	VercelAccount           string `json:"vercelAccount,omitempty"`
	TursoDB                 string `json:"tursoDb"`
	TursoAccount            string `json:"tursoAccount,omitempty"`
	GitHubAccount           string `json:"githubAccount,omitempty"`
	SiteURL                 string `json:"siteUrl"`
	CoreURL                 string `json:"coreUrl"`
	TursoURL                string `json:"tursoUrl"`
	TursoTokenDPAPI         string `json:"tursoTokenDpapi,omitempty"`
	TursoPlatformTokenDPAPI string `json:"tursoPlatformTokenDpapi,omitempty"`
	CoreKeyDPAPI            string `json:"coreKeyDpapi,omitempty"`
	UpdatedAt               string `json:"updatedAt"`
}

type runtimeState struct {
	Step               int
	ProjectName        string
	CloudflareProject  string
	CloudflareAccount  string
	VercelProject      string
	VercelAccount      string
	TursoDB            string
	TursoAccount       string
	GitHubAccount      string
	SiteURL            string
	CoreURL            string
	TursoURL           string
	TursoToken         string
	TursoPlatformToken string
	CoreKey            string
}

type appUI struct {
	hwnd     uintptr
	hFont    uintptr
	logEdit  uintptr
	stepList uintptr
	status   uintptr
	startBtn uintptr
	stopBtn  uintptr
	fields   map[int]uintptr
	copies   map[int]int
}

var (
	ui         appUI
	appRoot    string
	installDir string
	statePath  string
	logPath    string
	logFile    *os.File
	logMu      sync.Mutex
	runMu      sync.Mutex
	running    bool
	cancelRun  context.CancelFunc
	current    runtimeState
	wslDistro  string

	uiQueueMu    sync.Mutex
	uiQueue      []func()
	uiPumpPosted bool
)

var steps = []string{
	"1. Пошук/клонування проєкту та інструменти",
	"2. Cloudflare: акаунт / підтвердження",
	"3. Vercel: акаунт / підтвердження",
	"4. Turso: акаунт / підтвердження",
	"5. Початковий деплой Core + Site",
	"6. Створення Turso DB та отримання ключів",
	"7. Підключення секретів між сервісами",
	"8. Фінальний деплой і health-check",
	"9. Tampermonkey + папка extension",
}

func p16(s string) *uint16 { return syscall.StringToUTF16Ptr(sanitizeCLIText(s)) }

func loword(v uintptr) uint16 { return uint16(v & 0xffff) }

func wndProc(hwnd uintptr, message uint32, wParam, lParam uintptr) uintptr {
	switch message {
	case WM_COMMAND:
		id := int(loword(wParam))
		switch id {
		case CTRL_START:
			startInstall()
		case CTRL_STOP:
			stopInstall()
		case CTRL_OPEN_SITE:
			s := getText(ui.fields[CTRL_SITE_URL])
			if s != "" {
				openURL(s)
			}
		case CTRL_OPEN_CORE:
			s := getText(ui.fields[CTRL_CORE_URL])
			if s != "" {
				openURL(strings.TrimRight(s, "/") + "/api/health")
			}
		case CTRL_TAMPER:
			openURL("https://www.tampermonkey.net/")
		case CTRL_EXTENSION:
			openFolder(filepath.Join(appRoot, "extension"))
		case CTRL_CF_SIGNUP:
			openURL("https://dash.cloudflare.com/sign-up")
		case CTRL_VERCEL_SIGNUP:
			openURL("https://vercel.com/signup")
		case CTRL_TURSO_SIGNUP:
			openURL("https://turso.tech/")
		default:
			if fieldID, ok := ui.copies[id]; ok {
				copyText(getText(ui.fields[fieldID]))
			}
		}
		return 0
	case WM_APP_UI:
		drainUIQueue()
		return 0
	case WM_CLOSE:
		stopInstall()
		procPostQuitMessage.Call(0)
		return 0
	case WM_DESTROY:
		procPostQuitMessage.Call(0)
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, uintptr(message), wParam, lParam)
	return r
}

func main() {
	runtime.LockOSThread()
	exe, err := os.Executable()
	if err != nil {
		panic(err)
	}
	installDir = filepath.Dir(exe)
	appRoot = findProjectRoot()
	if appRoot == "" {
		appRoot = filepath.Join(installDir, "Anime-catalog")
	}
	statePath = filepath.Join(installDir, "installer-state.json")
	_ = os.MkdirAll(filepath.Join(installDir, "logs"), 0755)
	logPath = filepath.Join(installDir, "logs", "install-"+time.Now().Format("20060102-150405")+".log")
	logFile, _ = os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if logFile != nil {
		defer logFile.Close()
	}

	current = loadState()
	// State v1/v2 used three unrelated default project names and could also keep
	// deployment-specific URLs/tokens after a remote project had been deleted.
	// Starting with v1.1.7 a single explicit project name is the source of truth.
	// Legacy state keeps account authorization, but deployment wiring is cleared.
	if current.ProjectName == "" {
		clearDeploymentWiring(false)
	}

	createMainWindow()
	appendLog("YORU Installer v" + appVersion)
	appendLog("Project root: " + appRoot + " (якщо проєкту немає, він буде клонований сюди)")
	appendLog("State: " + statePath)
	appendLog("Secrets у state-файлі зберігаються через Windows DPAPI.")
	refreshUIFromState()

	var m msg
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func createMainWindow() {
	hInst, _, _ := procGetModuleHandleW.Call(0)
	className := p16("YoruInstallerWindow")
	wc := wndClassEx{
		CbSize:        uint32(unsafe.Sizeof(wndClassEx{})),
		LpfnWndProc:   syscall.NewCallback(wndProc),
		HInstance:     hInst,
		HbrBackground: 6,
		LpszClassName: className,
	}
	procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc)))
	style := uintptr(WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_VISIBLE)
	hwnd, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(p16("YORU Installer — автоматичне розгортання"))), style, 80, 60, 1220, 820, 0, 0, hInst, 0)
	ui.hwnd = hwnd

	font, _, _ := procCreateFontW.Call(18, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(p16("Segoe UI"))))
	ui.hFont = font
	ui.fields = map[int]uintptr{}
	ui.copies = map[int]int{}

	label(hwnd, "Етапи встановлення", 18, 16, 420, 24)
	ui.stepList = control("LISTBOX", "", WS_CHILD|WS_VISIBLE|WS_BORDER|WS_VSCROLL|LBS_NOTIFY|LBS_NOINTEGRALHEIGHT, 18, 44, 705, 190, hwnd, 1301)

	label(hwnd, "Лог", 18, 244, 100, 24)
	ui.logEdit = control("EDIT", "", WS_CHILD|WS_VISIBLE|WS_BORDER|WS_VSCROLL|WS_HSCROLL|ES_LEFT|ES_MULTILINE|ES_AUTOVSCROLL|ES_AUTOHSCROLL|ES_READONLY, 18, 272, 705, 430, hwnd, 1302)

	label(hwnd, "Параметри, ключі та посилання", 748, 16, 430, 24)
	addField("Корінь проєкту", CTRL_ROOT, 748, 46, false)
	addField("Назва проєкту (Cloudflare / Vercel / Turso)", CTRL_CF_PROJECT, 748, 104, true)
	addField("Site URL", CTRL_SITE_URL, 748, 162, false)
	addField("Vercel project", CTRL_VERCEL_PROJECT, 748, 220, false)
	addField("Core URL", CTRL_CORE_URL, 748, 278, false)
	addField("Turso database", CTRL_TURSO_DB, 748, 336, false)
	addField("TURSO_DATABASE_URL", CTRL_TURSO_URL, 748, 394, false)
	addField("TURSO_AUTH_TOKEN", CTRL_TURSO_TOKEN, 748, 452, false)
	addField("CORE_API_KEY", CTRL_CORE_KEY, 748, 510, false)

	label(hwnd, "Реєстрація / кабінети", 748, 570, 250, 20)
	button(hwnd, "Cloudflare", 748, 594, 105, 30, CTRL_CF_SIGNUP, false)
	button(hwnd, "Vercel", 862, 594, 95, 30, CTRL_VERCEL_SIGNUP, false)
	button(hwnd, "Turso", 966, 594, 85, 30, CTRL_TURSO_SIGNUP, false)
	button(hwnd, "Tampermonkey", 1060, 594, 112, 30, CTRL_TAMPER, false)

	ui.startBtn = button(hwnd, "Почати / продовжити", 18, 716, 190, 36, CTRL_START, true)
	ui.stopBtn = button(hwnd, "Зупинити", 218, 716, 110, 36, CTRL_STOP, false)
	button(hwnd, "Відкрити сайт", 338, 716, 120, 36, CTRL_OPEN_SITE, false)
	button(hwnd, "Core health", 468, 716, 110, 36, CTRL_OPEN_CORE, false)
	button(hwnd, "Tampermonkey", 588, 716, 125, 36, CTRL_TAMPER, false)
	button(hwnd, "Extension", 748, 716, 105, 36, CTRL_EXTENSION, false)

	ui.status = label(hwnd, "Готово до запуску", 870, 720, 305, 28)

	for _, s := range steps {
		procSendMessageW.Call(ui.stepList, LB_ADDSTRING, 0, uintptr(unsafe.Pointer(p16("○ "+s))))
	}

	procShowWindow.Call(hwnd, SW_SHOW)
	procUpdateWindow.Call(hwnd)
}

func control(class, text string, style uintptr, x, y, w, h int, parent uintptr, id int) uintptr {
	hwnd, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(p16(class))), uintptr(unsafe.Pointer(p16(text))), style, uintptr(x), uintptr(y), uintptr(w), uintptr(h), parent, uintptr(id), 0, 0)
	procSendMessageW.Call(hwnd, WM_SETFONT, ui.hFont, 1)
	return hwnd
}

func label(parent uintptr, text string, x, y, w, h int) uintptr {
	return control("STATIC", text, WS_CHILD|WS_VISIBLE, x, y, w, h, parent, 0)
}

func button(parent uintptr, text string, x, y, w, h, id int, def bool) uintptr {
	style := uintptr(WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON)
	if def {
		style |= BS_DEFPUSHBUTTON
	}
	return control("BUTTON", text, style, x, y, w, h, parent, id)
}

func addField(title string, id, x, y int, editable bool) {
	label(ui.hwnd, title, x, y, 360, 20)
	style := uintptr(WS_CHILD | WS_VISIBLE | WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL)
	if !editable {
		style |= ES_READONLY
	}
	e := control("EDIT", "", style, x, y+22, 365, 28, ui.hwnd, id)
	ui.fields[id] = e
	copyID := CTRL_COPY_BASE + len(ui.copies) + 1
	button(ui.hwnd, "Копіювати", x+372, y+22, 88, 28, copyID, false)
	ui.copies[copyID] = id
}

func setText(hwnd uintptr, s string) { procSetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(p16(s)))) }

func getText(hwnd uintptr) string {
	n, _, _ := procGetWindowTextLen.Call(hwnd)
	if n == 0 {
		return ""
	}
	buf := make([]uint16, int(n)+1)
	procGetWindowTextW.Call(hwnd, uintptr(unsafe.Pointer(&buf[0])), n+1)
	return syscall.UTF16ToString(buf)
}

func postUI(fn func()) {
	if fn == nil || ui.hwnd == 0 {
		return
	}
	shouldPost := false
	uiQueueMu.Lock()
	uiQueue = append(uiQueue, fn)
	if !uiPumpPosted {
		uiPumpPosted = true
		shouldPost = true
	}
	uiQueueMu.Unlock()
	if shouldPost {
		procPostMessageW.Call(ui.hwnd, WM_APP_UI, 0, 0)
	}
}

func drainUIQueue() {
	const maxPerPump = 128
	uiQueueMu.Lock()
	if len(uiQueue) == 0 {
		uiPumpPosted = false
		uiQueueMu.Unlock()
		return
	}
	n := len(uiQueue)
	if n > maxPerPump {
		n = maxPerPump
	}
	q := append([]func(){}, uiQueue[:n]...)
	uiQueue = uiQueue[n:]
	hasMore := len(uiQueue) > 0
	uiPumpPosted = hasMore
	uiQueueMu.Unlock()

	for _, fn := range q {
		func() {
			defer func() {
				if r := recover(); r != nil {
					line := time.Now().Format("15:04:05") + "  UI ПОМИЛКА: " + fmt.Sprint(r)
					logMu.Lock()
					if logFile != nil {
						_, _ = logFile.WriteString(line + "\r\n")
					}
					logMu.Unlock()
				}
			}()
			fn()
		}()
	}
	if hasMore {
		procPostMessageW.Call(ui.hwnd, WM_APP_UI, 0, 0)
	}
}

func appendLogDirect(line string) {
	if ui.logEdit == 0 {
		return
	}
	procSendMessageW.Call(ui.logEdit, EM_SETSEL, ^uintptr(0), ^uintptr(0))
	procSendMessageW.Call(ui.logEdit, EM_REPLACESEL, 0, uintptr(unsafe.Pointer(p16(line+"\r\n"))))
}

func appendLog(s string) {
	s = sanitizeCLIText(s)
	line := time.Now().Format("15:04:05") + "  " + s
	logMu.Lock()
	if logFile != nil {
		_, _ = logFile.WriteString(line + "\r\n")
	}
	logMu.Unlock()
	postUI(func() { appendLogDirect(line) })
}

func setStatusDirect(s string) {
	if ui.status != 0 {
		setText(ui.status, s)
	}
}
func setStatus(s string) { postUI(func() { setStatusDirect(s) }) }

func setStepDirect(index int, status string) {
	if index < 0 || index >= len(steps) {
		return
	}
	marker := "○"
	if status == "active" {
		marker = "▶"
	}
	if status == "done" {
		marker = "✓"
	}
	if status == "error" {
		marker = "✗"
	}
	items := make([]string, len(steps))
	for i, s := range steps {
		m := "○"
		if i < index {
			m = "✓"
		}
		if i == index {
			m = marker
		}
		items[i] = m + " " + s
	}
	procSendMessageW.Call(ui.stepList, LB_RESETCONTENT, 0, 0)
	for _, s := range items {
		procSendMessageW.Call(ui.stepList, LB_ADDSTRING, 0, uintptr(unsafe.Pointer(p16(s))))
	}
	procSendMessageW.Call(ui.stepList, LB_SETCURSEL, uintptr(index), 0)
}

func setStep(index int, status string) { postUI(func() { setStepDirect(index, status) }) }

func message(text, title string, flags uintptr) int {
	r, _, _ := procMessageBoxW.Call(ui.hwnd, uintptr(unsafe.Pointer(p16(text))), uintptr(unsafe.Pointer(p16(title))), flags)
	return int(r)
}

func messageSync(text, title string, flags uintptr) int {
	ch := make(chan int, 1)
	postUI(func() { ch <- message(text, title, flags) })
	return <-ch
}

func enable(hwnd uintptr, yes bool) {
	v := uintptr(0)
	if yes {
		v = 1
	}
	procEnableWindow.Call(hwnd, v)
}

func refreshUIFromStateDirect() {
	setText(ui.fields[CTRL_ROOT], appRoot)
	setText(ui.fields[CTRL_CF_PROJECT], current.ProjectName)
	setText(ui.fields[CTRL_SITE_URL], current.SiteURL)
	setText(ui.fields[CTRL_VERCEL_PROJECT], current.VercelProject)
	setText(ui.fields[CTRL_CORE_URL], current.CoreURL)
	setText(ui.fields[CTRL_TURSO_DB], current.TursoDB)
	setText(ui.fields[CTRL_TURSO_URL], current.TursoURL)
	setText(ui.fields[CTRL_TURSO_TOKEN], current.TursoToken)
	setText(ui.fields[CTRL_CORE_KEY], current.CoreKey)
	if current.Step > 0 {
		idx := current.Step
		if idx >= len(steps) {
			idx = len(steps) - 1
		}
		setStepDirect(idx, "active")
	}
}

func refreshUIFromState() { postUI(refreshUIFromStateDirect) }

func setFieldText(id int, value string) {
	postUI(func() {
		if h := ui.fields[id]; h != 0 {
			setText(h, value)
		}
	})
}

func normalizeSharedProjectName(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = strings.ReplaceAll(s, "_", "-")
	s = regexp.MustCompile(`\s+`).ReplaceAllString(s, "-")
	s = regexp.MustCompile(`-+`).ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	return s
}

func validSharedProjectName(s string) bool {
	if len(s) < 1 || len(s) > 48 {
		return false
	}
	return regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`).MatchString(s)
}

func hasDeploymentWiring() bool {
	return current.Step > 0 || current.SiteURL != "" || current.CoreURL != "" || current.TursoURL != "" || current.TursoToken != "" || current.CoreKey != ""
}

func clearDeploymentWiring(keepProject bool) {
	name := current.ProjectName
	current.Step = 0
	current.SiteURL = ""
	current.CoreURL = ""
	current.TursoURL = ""
	current.TursoToken = ""
	current.CoreKey = ""
	if !keepProject {
		name = ""
	}
	current.ProjectName = name
	current.CloudflareProject = name
	current.VercelProject = name
	current.TursoDB = name
}

func resetLocalProjectLinks() {
	// A fresh deployment must never inherit a previous Vercel project/team link.
	_ = os.RemoveAll(filepath.Join(projectCoreDir(appRoot), ".vercel"))
	_ = os.Remove(filepath.Join(projectCoreDir(appRoot), ".env.local"))
}

func beginFreshDeployment(name string) {
	// Account sessions are intentionally preserved and will still be confirmed in
	// their own steps. Everything that binds Site/Core/DB together is rotated.
	current.ProjectName = name
	current.CloudflareProject = name
	current.VercelProject = name
	current.TursoDB = name
	current.Step = 0
	current.SiteURL = ""
	current.CoreURL = ""
	current.TursoURL = ""
	current.TursoToken = ""
	current.CoreKey = randomHex(32)
	resetLocalProjectLinks()
	appendLog("Нове розгортання: усі сервіси матимуть спільну назву " + name)
	appendLog("Старі Site/Core/Turso URL, database token та CORE_API_KEY очищено; CORE_API_KEY згенеровано заново.")
	saveState()
	refreshUIFromStateDirect()
}

func prepareProjectForStart() bool {
	raw := strings.TrimSpace(getText(ui.fields[CTRL_CF_PROJECT]))
	if raw == "" {
		message("Введи власну назву проєкту.\n\nОдна й та сама назва буде використана для Cloudflare Pages, Vercel Core і Turso database. Поле навмисно не має назви за замовчуванням.", "Назва проєкту", MB_OK|MB_ICONWARNING)
		return false
	}
	name := normalizeSharedProjectName(raw)
	if !validSharedProjectName(name) {
		message("Назва має бути 1-48 символів і після нормалізації містити тільки латинські a-z, цифри та дефіси.\n\nНаприклад, пробіли автоматично перетворюються на дефіси. Кирилиця не підтримується сервісами як спільний slug.", "Некоректна назва проєкту", MB_OK|MB_ICONWARNING)
		return false
	}
	if name != raw {
		setText(ui.fields[CTRL_CF_PROJECT], name)
		message("Для сумісності всіх трьох сервісів назву нормалізовано до:\n\n"+name, "Назва проєкту", MB_OK|MB_ICONINFORMATION)
	}

	if current.ProjectName == "" || current.ProjectName != name {
		if current.ProjectName != "" && current.ProjectName != name {
			message("Назву змінено з «"+current.ProjectName+"» на «"+name+"».\n\nInstaller почне нове розгортання і автоматично створить нові URL, Turso database token та CORE_API_KEY.", "Нове розгортання", MB_OK|MB_ICONINFORMATION)
		}
		beginFreshDeployment(name)
		return true
	}

	// Same project name: let the user explicitly choose resume vs. clean re-test.
	if hasDeploymentWiring() {
		if message("Знайдено попередній стан для проєкту «"+name+"».\n\nТАК — продовжити попереднє встановлення з уже збереженими ключами/URL.\n\nНІ — почати чисте розгортання з цією ж назвою: старі URL і deployment-токени буде очищено, CORE_API_KEY буде згенеровано заново, а всі зв'язки переписані на сервісах.", "Продовжити чи почати заново?", MB_YESNO|MB_ICONINFORMATION) != IDYES {
			beginFreshDeployment(name)
			return true
		}
		appendLog("Продовжую попереднє розгортання проєкту " + name + ".")
	} else {
		current.CloudflareProject = name
		current.VercelProject = name
		current.TursoDB = name
		if current.CoreKey == "" {
			current.CoreKey = randomHex(32)
		}
		saveState()
		refreshUIFromStateDirect()
	}
	return true
}

func startInstall() {
	if !prepareProjectForStart() {
		return
	}
	runMu.Lock()
	if running {
		runMu.Unlock()
		return
	}
	running = true
	ctx, cancel := context.WithCancel(context.Background())
	cancelRun = cancel
	runMu.Unlock()

	// UI state is changed on the Win32 message thread before the worker starts.
	enable(ui.startBtn, false)
	enable(ui.stopBtn, true)
	setStatusDirect("Запуск...")
	saveState()
	appendLog("=== Запуск оркестратора ===")

	go installWorker(ctx)
}

func installWorker(ctx context.Context) {
	var err error
	func() {
		defer func() {
			if r := recover(); r != nil {
				err = fmt.Errorf("внутрішня помилка installer: %v", r)
			}
		}()
		err = runFlow(ctx)
	}()
	if err != nil {
		appendLog("ПОМИЛКА: " + err.Error())
		setStatus("Зупинено з помилкою")
		messageSync(err.Error()+"\n\nДеталі є у вікні логів та:\n"+logPath, "YORU Installer", MB_OK|MB_ICONERROR)
	} else {
		setStatus("Встановлення завершено")
		messageSync("Готово. Сайт, Core і Turso перевірені.\n\nTampermonkey та папка extension відкриті.", "YORU Installer", MB_OK|MB_ICONINFORMATION)
	}

	runMu.Lock()
	running = false
	cancelRun = nil
	runMu.Unlock()
	postUI(func() { enable(ui.startBtn, true); enable(ui.stopBtn, false) })
}

func stopInstall() {
	runMu.Lock()
	c := cancelRun
	runMu.Unlock()
	if c != nil {
		appendLog("Запит на зупинку...")
		c()
	}
}

func runFlow(ctx context.Context) error {
	if !validSharedProjectName(current.ProjectName) {
		return errors.New("не задано коректну спільну назву проєкту")
	}
	current.CloudflareProject = current.ProjectName
	current.VercelProject = current.ProjectName
	current.TursoDB = current.ProjectName
	type stepFn func(context.Context) error
	fns := []stepFn{
		stepPrerequisites,
		stepCloudflare,
		stepVercel,
		stepTursoAuth,
		stepInitialDeploy,
		stepTursoDB,
		stepWireSecrets,
		stepFinalDeploy,
		stepExtension,
	}

	for i, fn := range fns {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		setStep(i, "active")
		setStatus(steps[i])
		appendLog("--- " + steps[i] + " ---")
		if err := fn(ctx); err != nil {
			setStep(i, "error")
			current.Step = i
			saveState()
			return err
		}
		current.Step = i + 1
		saveState()
		refreshUIFromState()
		setStep(i, "done")
	}
	return nil
}

func projectCoreDir(path string) string {
	for _, name := range []string{"core", "vercel"} {
		p := filepath.Join(path, name)
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p
		}
	}
	return filepath.Join(path, "core")
}

func isProjectRoot(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	for _, d := range []string{"site", "extension"} {
		st, err := os.Stat(filepath.Join(path, d))
		if err != nil || !st.IsDir() {
			return false
		}
	}
	core := projectCoreDir(path)
	st, err := os.Stat(core)
	return err == nil && st.IsDir()
}

func findProjectRoot() string {
	candidates := []string{
		filepath.Dir(installDir),
		installDir,
		filepath.Join(installDir, "Anime-catalog"),
		filepath.Join(filepath.Dir(installDir), "Anime-catalog"),
	}
	seen := map[string]bool{}
	for _, c := range candidates {
		a, _ := filepath.Abs(c)
		key := strings.ToLower(filepath.Clean(a))
		if seen[key] {
			continue
		}
		seen[key] = true
		if isProjectRoot(a) {
			return a
		}
	}
	return ""
}

func addCommonToolPaths() {
	paths := []string{
		`C:\Program Files\GitHub CLI`,
		`C:\Program Files\Git\cmd`,
		filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "GitHub CLI"),
	}
	old := os.Getenv("PATH")
	for _, p := range paths {
		if p == "" {
			continue
		}
		if _, err := os.Stat(p); err == nil && !strings.Contains(strings.ToLower(old), strings.ToLower(p)) {
			old += ";" + p
		}
	}
	_ = os.Setenv("PATH", old)
}

func findTool(name string) string {
	addCommonToolPaths()
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	return ""
}

func ensureWindowsTool(ctx context.Context, exeName, wingetID, friendly, url string) (string, error) {
	if p := findTool(exeName); p != "" {
		return p, nil
	}
	if _, err := exec.LookPath("winget.exe"); err != nil {
		messageSync("Не знайдено "+friendly+". Він потрібен для автоматичного клонування проєкту.\n\nWindows Package Manager (winget) теж недоступний, тому зараз відкрию офіційну сторінку встановлення.", friendly, MB_OK|MB_ICONWARNING)
		openURL(url)
		return "", fmt.Errorf("%s не встановлений", friendly)
	}
	messageSync("Не знайдено "+friendly+".\n\nПрограма зараз встановить його автоматично через winget, а потім продовжить без перезапуску.", friendly, MB_OK|MB_ICONINFORMATION)
	appendLog("Встановлюю " + friendly + " через winget...")
	_, err := runDirect(ctx, installDir, "", nil, "winget.exe", "install", "--id", wingetID, "-e", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity")
	if err != nil {
		openURL(url)
		return "", fmt.Errorf("автоматичне встановлення %s: %w", friendly, err)
	}
	addCommonToolPaths()
	if p := findTool(exeName); p != "" {
		return p, nil
	}
	return "", fmt.Errorf("%s встановлено, але EXE ще не видно у PATH; перезапусти YORU Installer", friendly)
}

func ensureProject(ctx context.Context) error {
	if root := findProjectRoot(); root != "" {
		appRoot = root
		setFieldText(CTRL_ROOT, appRoot)
		appendLog("Проєкт знайдено: " + appRoot)
		return nil
	}

	target := filepath.Join(installDir, "Anime-catalog")
	appRoot = target
	setFieldText(CTRL_ROOT, appRoot)
	appendLog("Проєкт не знайдено. Автоматично клоную MysterSay/Anime-catalog у: " + target)

	if st, err := os.Stat(target); err == nil && st.IsDir() {
		entries, _ := os.ReadDir(target)
		if len(entries) > 0 {
			return fmt.Errorf("папка %s вже існує і не схожа на Anime-catalog. Перейменуй/видали її або перемісти YoruInstaller.exe", target)
		}
	}

	gh, err := ensureWindowsTool(ctx, "gh.exe", "GitHub.cli", "GitHub CLI", "https://cli.github.com/")
	if err != nil {
		return err
	}
	if _, err = ensureWindowsTool(ctx, "git.exe", "Git.Git", "Git", "https://git-scm.com/download/win"); err != nil {
		return err
	}
	if err = confirmExistingGitHubAccount(ctx, gh); err != nil {
		return err
	}

	appendLog("> gh repo clone MysterSay/Anime-catalog " + target)
	_, cloneErr := runDirect(ctx, installDir, "", nil, gh, "repo", "clone", "MysterSay/Anime-catalog", target)
	if cloneErr != nil {
		appendLog("Перша спроба clone не вдалася. Перевіряю GitHub authorization...")
		if _, authErr := runDirect(ctx, installDir, "", nil, gh, "auth", "status", "--hostname", "github.com"); authErr != nil {
			messageSync("GitHub CLI потребує входу для доступу до MysterSay/Anime-catalog.\n\nЗараз відкриється GitHub authorization. Підтвердь вхід у браузері — після цього програма сама повторить clone.", "GitHub", MB_OK|MB_ICONINFORMATION)
			if _, authErr = runDirect(ctx, installDir, "", openFirstURLHook(), gh, "auth", "login", "--web", "--hostname", "github.com"); authErr != nil {
				return fmt.Errorf("GitHub login: %w", authErr)
			}
			if st, statErr := os.Stat(target); statErr == nil && st.IsDir() && !isProjectRoot(target) {
				entries, _ := os.ReadDir(target)
				if len(entries) == 0 {
					_ = os.Remove(target)
				}
			}
			appendLog("> gh repo clone MysterSay/Anime-catalog " + target + " (retry)")
			_, cloneErr = runDirect(ctx, installDir, "", nil, gh, "repo", "clone", "MysterSay/Anime-catalog", target)
		}
	}
	if cloneErr != nil {
		return fmt.Errorf("gh repo clone MysterSay/Anime-catalog: %w", cloneErr)
	}
	if !isProjectRoot(target) {
		return fmt.Errorf("репозиторій клоновано, але структура Anime-catalog неповна: %s", target)
	}

	appRoot = target
	setFieldText(CTRL_ROOT, appRoot)
	appendLog("Проєкт успішно клоновано. Продовжую встановлення без перезапуску.")
	return nil
}

func stepPrerequisites(ctx context.Context) error {
	if err := ensureProject(ctx); err != nil {
		return err
	}
	for _, d := range []string{"site", "extension"} {
		p := filepath.Join(appRoot, d)
		st, err := os.Stat(p)
		if err != nil || !st.IsDir() {
			return fmt.Errorf("після пошуку/клонування не знайдено папку %s", p)
		}
	}
	corePath := projectCoreDir(appRoot)
	if st, err := os.Stat(corePath); err != nil || !st.IsDir() {
		return fmt.Errorf("після пошуку/клонування не знайдено папку ядра %s", corePath)
	}
	appendLog("Структура проєкту: OK")

	if _, err := runCmd(ctx, appRoot, "", nil, "node --version"); err != nil {
		messageSync("Не знайдено Node.js. Він потрібен для Wrangler і Vercel CLI.\n\nЗараз відкрию офіційний сайт Node.js. Встанови LTS і натисни «Почати / продовжити» ще раз.", "Потрібен Node.js", MB_OK|MB_ICONWARNING)
		openURL("https://nodejs.org/en/download")
		return errors.New("Node.js не встановлений")
	}
	if _, err := runCmd(ctx, appRoot, "", nil, "npx --version"); err != nil {
		return fmt.Errorf("npx недоступний: %w", err)
	}
	appendLog("Node.js / npx: OK")

	if _, err := runCaptureDecoded(ctx, appRoot, "wsl.exe", "--status"); err != nil {
		messageSync("Для офіційного Turso CLI на Windows потрібен WSL.\n\nВстанови WSL, перезапусти Windows якщо система попросить, після чого знову запусти YORU Installer.", "Потрібен WSL", MB_OK|MB_ICONWARNING)
		openURL("https://learn.microsoft.com/windows/wsl/install")
		return errors.New("WSL не готовий")
	}

	distro, err := chooseWSLDistro(ctx)
	if err != nil {
		return err
	}
	wslDistro = distro
	appendLog("WSL: OK; робочий дистрибутив: " + wslDistro)
	return nil
}

func identitySummary(out string, maxLines int) string {
	out = sanitizeCLIText(out)
	ansi := regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)
	out = ansi.ReplaceAllString(out, "")
	var lines []string
	for _, raw := range strings.Split(strings.ReplaceAll(out, "\r", ""), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		low := strings.ToLower(line)
		if strings.HasPrefix(low, "vercel cli ") || strings.HasPrefix(low, "wrangler ") || strings.HasPrefix(line, "⛅") {
			continue
		}
		lines = append(lines, line)
	}
	if len(lines) == 0 {
		return "(CLI не повернув опис акаунта)"
	}
	if maxLines > 0 && len(lines) > maxLines {
		lines = lines[:maxLines]
		lines = append(lines, "…")
	}
	return strings.Join(lines, "\n")
}

func confirmServiceAccount(service, summary string) bool {
	text := service + " CLI зараз використовує:\n\n" + summary + "\n\nВикористати саме цей акаунт для YORU?\n\nТак — продовжити.\nНі — вийти з нього та увійти/зареєструвати інший акаунт."
	return messageSync(text, service+" — підтвердження акаунта", MB_YESNO|MB_ICONINFORMATION) == IDYES
}

func resetServiceBinding(service string) {
	switch service {
	case "cloudflare":
		current.CloudflareAccount = ""
		current.SiteURL = ""
		setFieldText(CTRL_SITE_URL, "")
	case "vercel":
		current.VercelAccount = ""
		current.CoreURL = ""
		setFieldText(CTRL_CORE_URL, "")
		if appRoot != "" {
			_ = os.RemoveAll(filepath.Join(projectCoreDir(appRoot), ".vercel"))
			appendLog("Локальну .vercel-прив'язку очищено, щоб новий акаунт не успадкував старий project/team.")
		}
	case "turso":
		current.TursoAccount = ""
		current.TursoURL = ""
		current.TursoToken = ""
		current.TursoPlatformToken = ""
		setFieldText(CTRL_TURSO_URL, "")
		setFieldText(CTRL_TURSO_TOKEN, "")
	case "github":
		current.GitHubAccount = ""
	}
	saveState()
}

func cloudflareAccountLabel(out string) string {
	re := regexp.MustCompile(`(?i)associated with the email\s+([^\s]+)`)
	if m := re.FindStringSubmatch(out); len(m) == 2 {
		return strings.TrimRight(m[1], ".,;)")
	}
	return lastUsefulLine(out)
}

func ensureCloudflareAccount(ctx context.Context, siteDir string) error {
	for attempt := 1; attempt <= 6; attempt++ {
		out, err := runWrangler(ctx, siteDir, "", nil, "whoami")
		if err != nil || !strings.Contains(strings.ToLower(out), "logged in") {
			messageSync("Cloudflare CLI ще не авторизований.\n\nЗараз відкриється сторінка Cloudflare. Увійди або створи потрібний акаунт, а потім підтвердь OAuth/device login. Після входу installer ОБОВ'ЯЗКОВО покаже знайдений акаунт перед продовженням.", "Cloudflare", MB_OK|MB_ICONINFORMATION)
			openURL("https://dash.cloudflare.com/sign-up")
			if _, err = runWrangler(ctx, siteDir, "", openFirstURLHook(), "login", "--device"); err != nil {
				return fmt.Errorf("Cloudflare login: %w", err)
			}
			continue
		}

		summary := identitySummary(out, 12)
		appendLog("Cloudflare active identity:\n" + summary)
		if confirmServiceAccount("Cloudflare", summary) {
			current.CloudflareAccount = cloudflareAccountLabel(out)
			saveState()
			appendLog("Cloudflare акаунт підтверджено користувачем: " + current.CloudflareAccount)
			return nil
		}

		appendLog("Cloudflare акаунт відхилено користувачем; виконую logout і готую вхід в інший акаунт.")
		resetServiceBinding("cloudflare")
		_ = os.Unsetenv("CLOUDFLARE_API_TOKEN")
		_ = os.Unsetenv("CLOUDFLARE_API_KEY")
		_ = os.Unsetenv("CLOUDFLARE_EMAIL")
		_, _ = runWrangler(ctx, siteDir, "", nil, "logout")
		messageSync("Поточний Cloudflare-акаунт відхилено.\n\nЗараз відкриється нова авторизація. У браузері увійди або зареєструй ІНШИЙ потрібний акаунт. Після входу installer знову покаже його для підтвердження.", "Cloudflare — інший акаунт", MB_OK|MB_ICONINFORMATION)
		openURL("https://dash.cloudflare.com/sign-up")
		if _, err = runWrangler(ctx, siteDir, "", openFirstURLHook(), "login", "--device"); err != nil {
			return fmt.Errorf("Cloudflare login іншого акаунта: %w", err)
		}
	}
	return errors.New("Cloudflare: забагато спроб зміни акаунта")
}

func vercelToolRoot() string {
	return filepath.Join(installDir, ".tools", "vercel")
}

func vercelToolPath() string {
	return filepath.Join(vercelToolRoot(), "node_modules", ".bin", "vercel.cmd")
}

func vercelEntryPath() string {
	return filepath.Join(vercelToolRoot(), "node_modules", "vercel", "dist", "index.js")
}

func vercelNPMCacheDir() string {
	return filepath.Join(installDir, ".tools", "npm-cache")
}

func runVercel(ctx context.Context, dir, stdin string, hook func(string), args ...string) (string, error) {
	entry := vercelEntryPath()
	if _, err := os.Stat(entry); err != nil {
		return "", fmt.Errorf("Vercel CLI entrypoint не знайдено: %s", entry)
	}
	logArgs := []string{entry}
	logArgs = append(logArgs, args...)
	appendLog("> node " + redactCommand(joinArgsForLog(logArgs...)))
	return runDirect(ctx, dir, stdin, hook, "node", logArgs...)
}

func ensureVercelCLI(ctx context.Context, coreDir string) error {
	entry := vercelEntryPath()
	if _, err := os.Stat(entry); err == nil {
		if out, verr := runVercel(ctx, coreDir, "", nil, "--version"); verr == nil && strings.Contains(strings.ToLower(out), "vercel") {
			appendLog("Vercel CLI: OK (ізольована копія installer)")
			return nil
		}
		appendLog("Локальна копія Vercel CLI пошкоджена; перевстановлюю її в ізольованому каталозі.")
		_ = os.RemoveAll(vercelToolRoot())
		_ = os.RemoveAll(vercelNPMCacheDir())
	} else if st, rootErr := os.Stat(vercelToolRoot()); rootErr == nil && st.IsDir() {
		appendLog("Знайдено незавершену копію Vercel CLI від попередньої спроби; очищаю тільки install\\.tools\\vercel і локальний cache.")
		_ = os.RemoveAll(vercelToolRoot())
		_ = os.RemoveAll(vercelNPMCacheDir())
	}

	if err := os.MkdirAll(vercelToolRoot(), 0755); err != nil {
		return fmt.Errorf("не вдалося створити каталог Vercel CLI: %w", err)
	}
	if err := os.MkdirAll(vercelNPMCacheDir(), 0755); err != nil {
		return fmt.Errorf("не вдалося створити ізольований npm cache: %w", err)
	}

	appendLog("Встановлюю ізольований Vercel CLI " + vercelCLIVersion + " у install\\.tools\\vercel ...")
	installOnce := func() error {
		// Не передаємо абсолютні Windows-шляхи через cmd.exe --prefix/--cache.
		// npm запускається через node + npm-cli.js, cwd вже дорівнює .tools\vercel,
		// а окремий cache задається environment variable. Це прибирає проблему з
		// буквальними лапками у шляхах на кшталт <cwd>\"D:\...\.tools\vercel".
		oldCache, hadCache := os.LookupEnv("npm_config_cache")
		if err := os.Setenv("npm_config_cache", vercelNPMCacheDir()); err != nil {
			return err
		}
		defer func() {
			if hadCache {
				_ = os.Setenv("npm_config_cache", oldCache)
			} else {
				_ = os.Unsetenv("npm_config_cache")
			}
		}()
		return installNPMDirect(ctx, vercelToolRoot(), "vercel@"+vercelCLIVersion)
	}

	if err := installOnce(); err != nil {
		appendLog("Перша спроба встановлення Vercel CLI не вдалася; очищаю ЛИШЕ ізольований installer npm cache і повторюю один раз.")
		_ = os.RemoveAll(vercelToolRoot())
		_ = os.RemoveAll(vercelNPMCacheDir())
		_ = os.MkdirAll(vercelToolRoot(), 0755)
		_ = os.MkdirAll(vercelNPMCacheDir(), 0755)
		if retryErr := installOnce(); retryErr != nil {
			return fmt.Errorf("встановлення ізольованого Vercel CLI після повторної спроби: %w", retryErr)
		}
	}
	if _, err := os.Stat(entry); err != nil {
		return fmt.Errorf("Vercel CLI встановлено, але entrypoint %s не знайдено", entry)
	}
	out, err := runVercel(ctx, coreDir, "", nil, "--version")
	if err != nil {
		return fmt.Errorf("перевірка ізольованого Vercel CLI: %w", err)
	}
	appendLog("Vercel CLI готовий: " + strings.TrimSpace(lastUsefulLine(out)))
	return nil
}

func vercelAuthMissing(out string) bool {
	low := strings.ToLower(out)
	markers := []string{
		"no existing credentials",
		"not logged in",
		"not authenticated",
		"authentication required",
		"please log in",
		"please login",
		"run `vercel login`",
		"run vercel login",
	}
	for _, m := range markers {
		if strings.Contains(low, m) {
			return true
		}
	}
	return false
}

func ensureVercelAccount(ctx context.Context, coreDir string) error {
	if err := ensureVercelCLI(ctx, coreDir); err != nil {
		return err
	}

	for attempt := 1; attempt <= 6; attempt++ {
		out, err := runVercel(ctx, coreDir, "", nil, "whoami")
		if err != nil {
			if !vercelAuthMissing(out) {
				appendLog("Vercel whoami завершився технічною помилкою; повторний login НЕ запускається.")
				return fmt.Errorf("Vercel CLI technical error during whoami: %w", err)
			}
			messageSync("Vercel CLI працює, але не має активної авторизації.\n\nЗараз відкриється login. Увійди або створи потрібний акаунт. Після успішного входу installer спочатку виконає whoami і покаже знайдений username для підтвердження.", "Vercel", MB_OK|MB_ICONINFORMATION)
			openURL("https://vercel.com/signup")
			if _, err = runVercel(ctx, coreDir, "", openFirstURLHook(), "login"); err != nil {
				return fmt.Errorf("Vercel login: %w", err)
			}
			continue
		}

		username := strings.TrimSpace(lastUsefulLine(out))
		if username == "" {
			return errors.New("Vercel whoami успішний, але username порожній")
		}
		summary := "Користувач: " + username
		if teams, terr := runVercel(ctx, coreDir, "", nil, "teams", "ls"); terr == nil {
			ts := identitySummary(teams, 8)
			if ts != "" {
				summary += "\n\nДоступні teams/scopes:\n" + ts
			}
		}
		appendLog("Vercel active identity: " + username)
		if confirmServiceAccount("Vercel", summary) {
			current.VercelAccount = username
			saveState()
			appendLog("Vercel акаунт підтверджено користувачем: " + username)
			return nil
		}

		appendLog("Vercel акаунт відхилено користувачем; виконую logout і очищаю стару project/team прив'язку.")
		resetServiceBinding("vercel")
		_ = os.Unsetenv("VERCEL_TOKEN")
		_, _ = runVercel(ctx, coreDir, "", nil, "logout")
		messageSync("Поточний Vercel-акаунт відхилено.\n\nУвійди або зареєструй інший потрібний акаунт. Після входу installer знову покаже username/teams для підтвердження.", "Vercel — інший акаунт", MB_OK|MB_ICONINFORMATION)
		openURL("https://vercel.com/signup")
		if _, err = runVercel(ctx, coreDir, "", openFirstURLHook(), "login"); err != nil {
			return fmt.Errorf("Vercel login іншого акаунта: %w", err)
		}
	}
	return errors.New("Vercel: забагато спроб зміни акаунта")
}

func tursoAuthMissing(out string) bool {
	low := strings.ToLower(out)
	markers := []string{
		"you are not logged in",
		"please login",
		"please log in",
		"not authenticated",
		"authentication required",
	}
	for _, m := range markers {
		if strings.Contains(low, m) {
			return true
		}
	}
	return false
}

func acquireTursoPlatformToken(ctx context.Context, signup bool) error {
	current.TursoPlatformToken = ""
	verb := "login"
	if signup {
		verb = "signup"
	}
	appendLog("Turso: запускаю " + verb + " --headless; після браузерної авторизації потрібен Access Token.")
	out, err := runWSLWithoutTursoToken(ctx, "", openFirstURLHook(), "turso auth "+verb+" --headless")
	if err != nil && !strings.Contains(strings.ToLower(out), "visit") {
		return fmt.Errorf("Turso %s --headless: %w", verb, err)
	}

	for attempt := 1; attempt <= 4; attempt++ {
		messageSync("У браузері заверши вхід/реєстрацію Turso.\n\nНа сторінці Access Token натисни Copy. Можна копіювати як сам token, так і рядок `export TURSO_API_TOKEN=...`.\n\nПісля копіювання повернись у YORU Installer і натисни OK — вставляти вручну нікуди не треба, installer сам прочитає буфер обміну та перевірить token.", "Turso — скопіюй Access Token", MB_OK|MB_ICONINFORMATION)
		clip, cerr := readClipboardText()
		if cerr != nil {
			messageSync("Не вдалося прочитати буфер обміну: "+cerr.Error()+"\n\nСкопіюй Access Token ще раз і натисни OK.", "Turso", MB_OK|MB_ICONWARNING)
			continue
		}
		token := extractTursoPlatformToken(clip)
		if token == "" {
			messageSync("У буфері обміну не знайдено Turso Access Token.\n\nСкопіюй token на сторінці Turso (або весь рядок `export TURSO_API_TOKEN=...`) і натисни OK.", "Turso", MB_OK|MB_ICONWARNING)
			continue
		}
		current.TursoPlatformToken = token
		who, werr := runWSL(ctx, "", nil, "turso auth whoami")
		if werr == nil && !tursoAuthMissing(who) && strings.TrimSpace(lastUsefulLine(who)) != "" {
			saveState()
			appendLog("Turso Access Token отримано з буфера обміну, перевірено та збережено через DPAPI.")
			return nil
		}
		current.TursoPlatformToken = ""
		saveState()
		messageSync("Скопійований Turso Access Token не пройшов перевірку.\n\nПереконайся, що скопійовано саме Access Token для щойно вибраного акаунта, а не database token.", "Turso token не прийнято", MB_OK|MB_ICONWARNING)
	}
	return errors.New("Turso: не вдалося отримати валідний Access Token з буфера обміну")
}

func ensureTursoAccount(ctx context.Context) error {
	for attempt := 1; attempt <= 6; attempt++ {
		out, err := runWSL(ctx, "", nil, "turso auth whoami")
		missing := tursoAuthMissing(out) || strings.TrimSpace(lastUsefulLine(out)) == ""
		if err != nil || missing {
			// A saved platform token may have expired; do not let an error string become a fake identity.
			current.TursoPlatformToken = ""
			saveState()
			messageSync("Turso CLI не має підтвердженої активної авторизації.\n\nЗараз installer відкриє Turso у браузері. Після входу/реєстрації Turso покаже Access Token — натисни Copy. Потім installer сам забере token із буфера обміну та перевірить акаунт.", "Turso", MB_OK|MB_ICONINFORMATION)
			if aerr := acquireTursoPlatformToken(ctx, false); aerr != nil {
				appendLog("Turso login flow не завершився; пробую signup flow...")
				if aerr = acquireTursoPlatformToken(ctx, true); aerr != nil {
					return fmt.Errorf("Turso auth: %w", aerr)
				}
			}
			continue
		}

		username := strings.TrimSpace(lastUsefulLine(out))
		if tursoAuthMissing(username) || strings.Contains(strings.ToLower(username), "not logged in") {
			current.TursoPlatformToken = ""
			continue
		}
		summary := "Користувач/organization: " + username
		if orgs, oerr := runWSL(ctx, "", nil, "turso org list"); oerr == nil && !tursoAuthMissing(orgs) {
			osum := identitySummary(orgs, 8)
			if osum != "" {
				summary += "\n\nДоступні organizations:\n" + osum
			}
		}
		appendLog("Turso active identity: " + username)
		if confirmServiceAccount("Turso", summary) {
			current.TursoAccount = username
			// If this was an old CLI session, capture its current API token for resume.
			if current.TursoPlatformToken == "" {
				if tokOut, terr := runWSL(ctx, "", nil, "turso auth token"); terr == nil {
					if tok := extractTursoPlatformToken(tokOut); tok != "" {
						current.TursoPlatformToken = tok
					}
				}
			}
			saveState()
			appendLog("Turso акаунт підтверджено користувачем: " + username)
			return nil
		}

		appendLog("Turso акаунт відхилено користувачем; виконую logout і очищаю DB URL/token та platform token зі state.")
		_, _ = runWSL(ctx, "", nil, "turso auth logout")
		resetServiceBinding("turso")
		messageSync("Поточний Turso-акаунт відхилено.\n\nЗараз відкриється авторизація іншого акаунта. Після входу на сторінці Turso натисни Copy Access Token; installer сам прочитає буфер обміну, а потім ще раз покаже знайдений Turso username/organization для підтвердження.", "Turso — інший акаунт", MB_OK|MB_ICONINFORMATION)
		if err = acquireTursoPlatformToken(ctx, false); err != nil {
			return fmt.Errorf("Turso auth іншого акаунта: %w", err)
		}
	}
	return errors.New("Turso: забагато спроб зміни акаунта")
}

func githubIdentity(ctx context.Context, gh string) (string, string, error) {
	out, err := runDirect(ctx, installDir, "", nil, gh, "api", "user")
	if err != nil {
		return "", "", err
	}
	var u struct {
		Login string `json:"login"`
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if json.Unmarshal([]byte(out), &u) != nil || strings.TrimSpace(u.Login) == "" {
		return "", identitySummary(out, 8), nil
	}
	summary := "GitHub: @" + u.Login
	if strings.TrimSpace(u.Name) != "" {
		summary += "\nІм'я: " + strings.TrimSpace(u.Name)
	}
	if strings.TrimSpace(u.Email) != "" {
		summary += "\nEmail: " + strings.TrimSpace(u.Email)
	}
	return u.Login, summary, nil
}

func confirmExistingGitHubAccount(ctx context.Context, gh string) error {
	if _, err := runDirect(ctx, installDir, "", nil, gh, "auth", "status", "--active", "--hostname", "github.com"); err != nil {
		appendLog("GitHub CLI не має активного акаунта; для публічного clone підтвердження GitHub не потрібне, якщо clone пройде без login.")
		return nil
	}
	for attempt := 1; attempt <= 6; attempt++ {
		login, summary, err := githubIdentity(ctx, gh)
		if err != nil {
			return nil
		}
		if confirmServiceAccount("GitHub", summary) {
			current.GitHubAccount = login
			saveState()
			appendLog("GitHub акаунт підтверджено користувачем: " + login)
			return nil
		}
		resetServiceBinding("github")
		_ = os.Unsetenv("GH_TOKEN")
		_ = os.Unsetenv("GITHUB_TOKEN")
		if login != "" {
			_, _ = runDirect(ctx, installDir, "", nil, gh, "auth", "logout", "--hostname", "github.com", "--user", login)
		}
		messageSync("Поточний GitHub-акаунт відхилено. Увійди в інший акаунт; після login installer знову покаже його для підтвердження.", "GitHub — інший акаунт", MB_OK|MB_ICONINFORMATION)
		if _, err = runDirect(ctx, installDir, "", openFirstURLHook(), gh, "auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https"); err != nil {
			return fmt.Errorf("GitHub login іншого акаунта: %w", err)
		}
	}
	return errors.New("GitHub: забагато спроб зміни акаунта")
}

func stepCloudflare(ctx context.Context) error {
	siteDir := filepath.Join(appRoot, "site")
	return ensureCloudflareAccount(ctx, siteDir)
}

func stepVercel(ctx context.Context) error {
	coreDir := projectCoreDir(appRoot)
	return ensureVercelAccount(ctx, coreDir)
}

func tursoShell(command string) string {
	q := strings.ReplaceAll(command, "'", "'\\''")
	return "bash -lc 'export PATH=\"$HOME/.turso:$HOME/.local/bin:$PATH\"; " + q + "'"
}

func runWSL(ctx context.Context, stdin string, hook func(string), command string) (string, error) {
	args := []string{}
	if strings.TrimSpace(wslDistro) != "" {
		args = append(args, "-d", wslDistro, "--")
	}
	prefix := "export PATH=\"$HOME/.turso:$HOME/.local/bin:$PATH\"; "
	if strings.TrimSpace(current.TursoPlatformToken) != "" {
		prefix += "export TURSO_API_TOKEN=" + shQuote(current.TursoPlatformToken) + "; "
	}
	args = append(args, "bash", "-lc", prefix+command)
	return runDirect(ctx, appRoot, stdin, hook, "wsl.exe", args...)
}

func runWSLWithoutTursoToken(ctx context.Context, stdin string, hook func(string), command string) (string, error) {
	saved := current.TursoPlatformToken
	current.TursoPlatformToken = ""
	defer func() { current.TursoPlatformToken = saved }()
	return runWSL(ctx, stdin, hook, command)
}

func stepTursoAuth(ctx context.Context) error {
	if _, err := runWSL(ctx, "", nil, "command -v turso >/dev/null 2>&1"); err != nil {
		messageSync("Turso CLI не знайдено у WSL. Програма зараз встановить офіційний CLI командою Turso install script.", "Turso CLI", MB_OK|MB_ICONINFORMATION)
		if _, err = runWSL(ctx, "", nil, "curl -sSfL https://get.tur.so/install.sh | bash"); err != nil {
			return fmt.Errorf("встановлення Turso CLI: %w", err)
		}
	}
	appendLog("Turso CLI: OK")
	return ensureTursoAccount(ctx)
}

func stepInitialDeploy(ctx context.Context) error {
	current.CloudflareProject = current.ProjectName
	current.VercelProject = current.ProjectName
	current.TursoDB = current.ProjectName
	coreDir := projectCoreDir(appRoot)
	siteDir := filepath.Join(appRoot, "site")

	appendLog("Початковий deploy Vercel Core...")
	// link --project is attempted first; if the project does not yet exist, deploy --yes can create/link one.
	_, _ = runVercel(ctx, coreDir, "", nil, "link", "--yes", "--project", current.VercelProject)
	out, err := runVercel(ctx, coreDir, "", nil, "deploy", "--prod", "--yes")
	if err != nil {
		messageSync("Автоматичний Vercel deploy не завершився. Я відкрию Projects.\n\nЯкщо CLI попросив створити project, створи порожній project для Python Core, потім повернись і натисни «Почати / продовжити».", "Vercel project", MB_OK|MB_ICONWARNING)
		openURL("https://vercel.com/new")
		return fmt.Errorf("початковий Vercel deploy: %w", err)
	}
	if u := vercelStableURL(out); u != "" {
		current.CoreURL = strings.TrimRight(u, "/")
	}
	if current.CoreURL == "" {
		return errors.New("не вдалося визначити Vercel deployment URL з консолі")
	}
	setFieldText(CTRL_CORE_URL, current.CoreURL)
	saveState()
	appendLog("Core URL: " + current.CoreURL)

	appendLog("Створюю/перевіряю Cloudflare Pages project...")
	createOut, _ := runWrangler(ctx, siteDir, "", nil, "pages", "project", "create", current.CloudflareProject, "--production-branch", "main")
	out, err = runWrangler(ctx, siteDir, "", nil, "pages", "deploy", ".", "--project-name", current.CloudflareProject)
	if err != nil {
		messageSync("Cloudflare Pages deploy не завершився. Перевір лог. Якщо ім'я project зайняте/невірне — зміни поле Cloudflare project і запусти знову.", "Cloudflare Pages", MB_OK|MB_ICONWARNING)
		return fmt.Errorf("початковий Cloudflare deploy: %w", err)
	}
	if u := lastURLMatching(out, regexp.MustCompile(`https://[A-Za-z0-9.-]+\.pages\.dev`)); u != "" {
		appendLog("Cloudflare deployment URL: " + u)
	}
	current.SiteURL = cloudflarePagesStableURL(createOut, out)
	if current.SiteURL == "" {
		return errors.New("не вдалося визначити реальний Cloudflare Pages URL з output Wrangler")
	}
	setFieldText(CTRL_SITE_URL, current.SiteURL)
	saveState()
	appendLog("Site URL: " + current.SiteURL)
	return nil
}

func stepTursoDB(ctx context.Context) error {
	current.TursoDB = current.ProjectName
	appendLog("Перевіряю Turso database " + current.TursoDB + "...")
	if _, err := runWSL(ctx, "", nil, "turso db show "+shQuote(current.TursoDB)+" --url"); err != nil {
		if _, err = runWSL(ctx, "", nil, "turso db create "+shQuote(current.TursoDB)+" --wait"); err != nil {
			return fmt.Errorf("створення Turso DB: %w", err)
		}
	}
	out, err := runWSL(ctx, "", nil, "turso db show "+shQuote(current.TursoDB)+" --url")
	if err != nil {
		return fmt.Errorf("Turso db show --url: %w", err)
	}
	reURL := regexp.MustCompile(`libsql://[^\s]+`)
	current.TursoURL = strings.TrimSpace(reURL.FindString(out))
	if current.TursoURL == "" {
		return errors.New("Turso URL не знайдено у виводі CLI")
	}
	setFieldText(CTRL_TURSO_URL, current.TursoURL)
	appendLog("TURSO_DATABASE_URL: " + current.TursoURL)

	if current.TursoToken == "" {
		out, err = runWSL(ctx, "", nil, "turso db tokens create "+shQuote(current.TursoDB)+" --expiration never")
		if err != nil {
			return fmt.Errorf("Turso token create: %w", err)
		}
		current.TursoToken = extractJWT(out)
		if current.TursoToken == "" {
			return errors.New("Turso token не вдалося автоматично витягнути з консолі")
		}
	}
	setFieldText(CTRL_TURSO_TOKEN, current.TursoToken)
	if current.CoreKey == "" {
		current.CoreKey = randomHex(32)
	}
	setFieldText(CTRL_CORE_KEY, current.CoreKey)
	saveState()
	appendLog("TURSO_AUTH_TOKEN: отримано і збережено через DPAPI (у лог token не друкується).")
	appendLog("CORE_API_KEY: згенеровано локально і збережено через DPAPI.")
	return nil
}

func stepWireSecrets(ctx context.Context) error {
	appendLog("Переприв'язую всі сервіси до поточних URL та свіжих ключів; значення на Cloudflare/Vercel будуть перезаписані.")
	siteDir := filepath.Join(appRoot, "site")
	coreDir := projectCoreDir(appRoot)
	if current.TursoURL == "" || current.TursoToken == "" || current.CoreURL == "" || current.SiteURL == "" {
		return errors.New("не вистачає URL/token для підключення сервісів")
	}

	cfSecrets := map[string]string{
		"TURSO_DATABASE_URL":      current.TursoURL,
		"TURSO_AUTH_TOKEN":        current.TursoToken,
		"CORE_API_KEY":            current.CoreKey,
		"CORE_SEARCH_URL":         current.CoreURL + "/api/search",
		"CORE_TAXONOMY_URL":       current.CoreURL + "/api/taxonomy",
		"CORE_PROCESS_STREAM_URL": current.CoreURL + "/api/process-stream",
		"CORE_PROCESS_FULL_URL":   current.CoreURL + "/api/process-full",
	}
	for k, v := range cfSecrets {
		appendLog("Cloudflare secret: " + k)
		_, err := runWrangler(ctx, siteDir, v+"\n", nil, "pages", "secret", "put", k, "--project-name", current.CloudflareProject)
		if err != nil {
			return fmt.Errorf("Cloudflare secret %s: %w", k, err)
		}
	}

	vercelEnv := map[string]string{
		"CORE_API_KEY":       current.CoreKey,
		"RESULT_WEBHOOK_URL": strings.TrimRight(current.SiteURL, "/") + "/api/ingest",
	}
	for k, v := range vercelEnv {
		appendLog("Vercel env: " + k)
		// Remove is best-effort; add then receives the value over stdin and never prints it from us.
		_, _ = runVercel(ctx, coreDir, "", nil, "env", "rm", k, "production", "--yes")
		_, err := runVercel(ctx, coreDir, v+"\n", nil, "env", "add", k, "production")
		if err != nil {
			return fmt.Errorf("Vercel env %s: %w", k, err)
		}
	}
	return nil
}

func stepFinalDeploy(ctx context.Context) error {
	coreDir := projectCoreDir(appRoot)
	siteDir := filepath.Join(appRoot, "site")

	appendLog("Фінальний deploy Vercel Core з environment variables...")
	out, err := runVercel(ctx, coreDir, "", nil, "deploy", "--prod", "--yes")
	if err != nil {
		return fmt.Errorf("фінальний Vercel deploy: %w", err)
	}
	if u := vercelStableURL(out); u != "" {
		current.CoreURL = strings.TrimRight(u, "/")
	}
	setFieldText(CTRL_CORE_URL, current.CoreURL)

	// In case production URL changed, refresh Cloudflare Core endpoints before the final site deployment.
	if current.CoreURL != "" {
		vals := map[string]string{
			"CORE_SEARCH_URL":         current.CoreURL + "/api/search",
			"CORE_TAXONOMY_URL":       current.CoreURL + "/api/taxonomy",
			"CORE_PROCESS_STREAM_URL": current.CoreURL + "/api/process-stream",
			"CORE_PROCESS_FULL_URL":   current.CoreURL + "/api/process-full",
		}
		for k, v := range vals {
			_, err = runWrangler(ctx, siteDir, v+"\n", nil, "pages", "secret", "put", k, "--project-name", current.CloudflareProject)
			if err != nil {
				return fmt.Errorf("оновлення Cloudflare %s: %w", k, err)
			}
		}
	}

	appendLog("Фінальний deploy Cloudflare Pages...")
	finalCFOut, cfErr := runWrangler(ctx, siteDir, "", nil, "pages", "deploy", ".", "--project-name", current.CloudflareProject)
	if cfErr != nil {
		return fmt.Errorf("фінальний Cloudflare deploy: %w", cfErr)
	}

	appendLog("Розгортаю native player preview aliases (Universal DOM Viewer mode)...")
	playerBranches := []string{"p-anihub", "p-animeon", "p-jutsu", "p-animego"}
	for _, branch := range playerBranches {
		appendLog("Cloudflare player alias: " + branch + "." + current.CloudflareProject + ".pages.dev")
		if _, branchErr := runWrangler(ctx, siteDir, "", nil, "pages", "deploy", ".", "--project-name", current.CloudflareProject, "--branch", branch, "--commit-dirty=true"); branchErr != nil {
			return fmt.Errorf("Cloudflare player preview %s: %w", branch, branchErr)
		}
	}
	if detected := cloudflarePagesStableURL("", finalCFOut); detected != "" && detected != current.SiteURL {
		appendLog("Cloudflare production URL уточнено після фінального deploy: " + detected)
		current.SiteURL = detected
		setFieldText(CTRL_SITE_URL, current.SiteURL)
	}

	saveState()
	refreshUIFromState()
	appendLog("Перевіряю Core health...")
	if err = waitHTTP(strings.TrimRight(current.CoreURL, "/")+"/api/health", 10, 4*time.Second); err != nil {
		return fmt.Errorf("Core health: %w", err)
	}
	appendLog("Core health: OK")
	appendLog("Перевіряю Site health...")
	if err = waitHTTP(strings.TrimRight(current.SiteURL, "/")+"/api/health", 12, 4*time.Second); err != nil {
		return fmt.Errorf("Site health: %w", err)
	}
	appendLog("Site health: OK")
	appendLog("Перевіряю Site version...")
	if err = waitHTTP(strings.TrimRight(current.SiteURL, "/")+"/api/version", 6, 3*time.Second); err != nil {
		return fmt.Errorf("Site version: %w", err)
	}
	appendLog("Site version: OK")
	appendLog("Перевіряю реальне підключення Site -> Core за /api/version...")
	if err = verifySiteCoreWiring(current.SiteURL, current.CoreURL); err != nil {
		return fmt.Errorf("Site/Core wiring: %w", err)
	}
	appendLog("Site -> Core wiring: OK")
	return nil
}

func patchExtensionSiteURL(siteURL string) (int, error) {
	base := strings.TrimRight(strings.TrimSpace(siteURL), "/")
	if base == "" {
		return 0, errors.New("Site URL порожній")
	}
	extDir := filepath.Join(appRoot, "extension")
	files, err := filepath.Glob(filepath.Join(extDir, "anime-to-yoru-collector-*.user.js"))
	if err != nil {
		return 0, err
	}
	if len(files) == 0 {
		return 0, errors.New("не знайдено anime-to-yoru-collector-*.user.js")
	}

	reDefault := regexp.MustCompile(`(?m)^(\s*const\s+DEFAULT_BASE\s*=\s*)['"][^'"]+['"]\s*;`)
	reLegacy := regexp.MustCompile(`(?m)^(\s*const\s+BASE\s*=\s*)['"][^'"]+['"]\s*;`)
	patched := 0
	quoted := strconv.Quote(base)
	for _, path := range files {
		raw, readErr := os.ReadFile(path)
		if readErr != nil {
			return patched, readErr
		}
		text := string(raw)
		updated := reDefault.ReplaceAllString(text, `${1}`+quoted+`;`)
		if updated == text {
			updated = reLegacy.ReplaceAllString(text, `${1}`+quoted+`;`)
		}
		if updated == text {
			continue
		}
		info, statErr := os.Stat(path)
		mode := os.FileMode(0644)
		if statErr == nil {
			mode = info.Mode()
		}
		if writeErr := os.WriteFile(path, []byte(updated), mode); writeErr != nil {
			return patched, writeErr
		}
		patched++
	}
	return patched, nil
}

func stepExtension(ctx context.Context) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if current.SiteURL != "" {
		patched, patchErr := patchExtensionSiteURL(current.SiteURL)
		if patchErr != nil {
			appendLog("УВАГА: не вдалося автоматично прописати Site URL у userscript: " + patchErr.Error())
			appendLog("Його можна змінити прямо в панелі розширення: Shift + клік по домену у заголовку.")
		} else if patched > 0 {
			appendLog(fmt.Sprintf("Extension прив'язано до Site URL %s (%d файл(и)).", current.SiteURL, patched))
		}
	}
	appendLog("Відкриваю офіційну сторінку Tampermonkey...")
	openURL("https://www.tampermonkey.net/")
	time.Sleep(700 * time.Millisecond)
	ext := filepath.Join(appRoot, "extension")
	appendLog("Відкриваю папку: " + ext)
	openFolder(ext)
	return nil
}

func sanitizeCLIText(s string) string {
	if strings.IndexByte(s, 0) >= 0 {
		s = strings.ReplaceAll(s, "\x00", "")
	}
	return strings.TrimPrefix(s, "\ufeff")
}

func decodeCommandOutput(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	start := 0
	utf16le := false
	if len(b) >= 2 && b[0] == 0xff && b[1] == 0xfe {
		utf16le = true
		start = 2
	} else {
		pairs := len(b) / 2
		if pairs > 4 {
			zeros := 0
			for i := 1; i < pairs*2; i += 2 {
				if b[i] == 0 {
					zeros++
				}
			}
			utf16le = zeros*100/pairs >= 35
		}
	}
	if utf16le {
		n := (len(b) - start) / 2
		units := make([]uint16, 0, n)
		for i := start; i+1 < len(b); i += 2 {
			units = append(units, uint16(b[i])|uint16(b[i+1])<<8)
		}
		return sanitizeCLIText(string(utf16.Decode(units)))
	}
	return sanitizeCLIText(string(b))
}

func runCaptureDecoded(ctx context.Context, dir, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	out, err := cmd.CombinedOutput()
	text := decodeCommandOutput(out)
	if ctx.Err() != nil {
		return text, ctx.Err()
	}
	if err != nil {
		return text, fmt.Errorf("%s: %w", name, err)
	}
	return text, nil
}

func chooseWSLDistro(ctx context.Context) (string, error) {
	out, err := runCaptureDecoded(ctx, appRoot, "wsl.exe", "-l", "-q")
	if err != nil {
		return "", fmt.Errorf("не вдалося отримати список WSL-дистрибутивів: %w", err)
	}
	var usable []string
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r", ""), "\n") {
		name := strings.TrimSpace(strings.TrimPrefix(line, "*"))
		if name == "" {
			continue
		}
		low := strings.ToLower(name)
		if strings.HasPrefix(low, "docker-desktop") {
			continue
		}
		usable = append(usable, name)
	}
	if len(usable) > 0 {
		for _, name := range usable {
			if strings.EqualFold(name, "Ubuntu") || strings.HasPrefix(strings.ToLower(name), "ubuntu-") {
				return name, nil
			}
		}
		return usable[0], nil
	}

	messageSync("WSL встановлено, але знайдено лише службовий docker-desktop. Він не підходить для Turso CLI.\n\nInstaller зараз спробує встановити Ubuntu у WSL. Windows може попросити права адміністратора або перезапуск.", "Потрібен Linux-дистрибутив WSL", MB_OK|MB_ICONINFORMATION)
	appendLog("У WSL немає користувацького Linux-дистрибутива; пробую встановити Ubuntu...")
	installOut, installErr := runCaptureDecoded(ctx, appRoot, "wsl.exe", "--install", "-d", "Ubuntu", "--no-launch")
	if strings.TrimSpace(installOut) != "" {
		for _, line := range strings.Split(strings.ReplaceAll(installOut, "\r", ""), "\n") {
			if strings.TrimSpace(line) != "" {
				appendLog(line)
			}
		}
	}
	if installErr != nil {
		openURL("https://learn.microsoft.com/windows/wsl/install")
		return "", fmt.Errorf("не вдалося автоматично встановити Ubuntu у WSL: %w", installErr)
	}

	out, _ = runCaptureDecoded(ctx, appRoot, "wsl.exe", "-l", "-q")
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r", ""), "\n") {
		name := strings.TrimSpace(strings.TrimPrefix(line, "*"))
		if strings.EqualFold(name, "Ubuntu") || strings.HasPrefix(strings.ToLower(name), "ubuntu-") {
			messageSync("Ubuntu встановлено у WSL. Якщо це перший запуск дистрибутива, Windows може попросити завершити його ініціалізацію.\n\nПісля цього натисни «Почати / продовжити» ще раз. Installer збереже весь поточний стан.", "WSL Ubuntu встановлено", MB_OK|MB_ICONINFORMATION)
			return "", errors.New("Ubuntu встановлено; потрібна первинна ініціалізація WSL-дистрибутива")
		}
	}
	return "", errors.New("Ubuntu не з'явився у списку WSL; можливо, Windows потребує перезапуску")
}

func joinArgsForLog(args ...string) string {
	parts := make([]string, 0, len(args))
	for _, a := range args {
		if strings.ContainsAny(a, " \t\"") {
			parts = append(parts, cmdQuote(a))
		} else {
			parts = append(parts, a)
		}
	}
	return strings.Join(parts, " ")
}

func npmCLIPath() (string, error) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return "", fmt.Errorf("node не знайдено: %w", err)
	}
	base := filepath.Dir(nodePath)
	candidates := []string{
		filepath.Join(base, "node_modules", "npm", "bin", "npm-cli.js"),
		filepath.Join(base, "node_modules", "npm", "bin", "npm-cli.cjs"),
	}
	for _, c := range candidates {
		if _, statErr := os.Stat(c); statErr == nil {
			return c, nil
		}
	}
	return "", fmt.Errorf("npm-cli.js не знайдено біля Node.js (%s)", base)
}

func npxCLIPath() (string, error) {
	nodePath, err := exec.LookPath("node")
	if err != nil {
		return "", fmt.Errorf("node не знайдено: %w", err)
	}
	base := filepath.Dir(nodePath)
	candidates := []string{
		filepath.Join(base, "node_modules", "npm", "bin", "npx-cli.js"),
		filepath.Join(base, "node_modules", "npm", "bin", "npx-cli.cjs"),
	}
	for _, c := range candidates {
		if _, statErr := os.Stat(c); statErr == nil {
			return c, nil
		}
	}
	return "", fmt.Errorf("npx-cli.js не знайдено біля Node.js (%s)", base)
}

func runNpxPackage(ctx context.Context, dir, stdin string, hook func(string), pkg string, args ...string) (string, error) {
	npxCLI, err := npxCLIPath()
	if err != nil {
		return "", err
	}
	all := []string{npxCLI, "--yes", pkg}
	all = append(all, args...)
	appendLog("> node " + redactCommand(joinArgsForLog(all...)))
	return runDirect(ctx, dir, stdin, hook, "node", all...)
}

func runWrangler(ctx context.Context, dir, stdin string, hook func(string), args ...string) (string, error) {
	return runNpxPackage(ctx, dir, stdin, hook, "wrangler@4.120.0", args...)
}

func installNPMDirect(ctx context.Context, dir string, pkg string) error {
	npmCLI, err := npmCLIPath()
	if err != nil {
		return err
	}
	args := []string{npmCLI, "install", "--no-audit", "--no-fund", pkg}
	appendLog("> node " + redactCommand(joinArgsForLog(args...)))
	_, err = runDirect(ctx, dir, "", nil, "node", args...)
	return err
}

func runCmd(ctx context.Context, dir, stdin string, hook func(string), command string) (string, error) {
	appendLog("> " + redactCommand(command))
	return runDirect(ctx, dir, stdin, hook, "cmd.exe", "/d", "/s", "/c", command)
}

func runDirect(ctx context.Context, dir, stdin string, hook func(string), name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return "", err
	}
	if err = cmd.Start(); err != nil {
		return "", err
	}

	var buf bytes.Buffer
	var mu sync.Mutex
	var wg sync.WaitGroup
	scan := func(r io.Reader) {
		defer wg.Done()
		sc := bufio.NewScanner(r)
		sc.Buffer(make([]byte, 4096), 1024*1024)
		for sc.Scan() {
			line := sanitizeCLIText(strings.TrimRight(sc.Text(), "\r\n"))
			mu.Lock()
			buf.WriteString(line)
			buf.WriteByte('\n')
			mu.Unlock()
			safe := redactLine(line)
			if strings.TrimSpace(safe) != "" {
				appendLog(safe)
			}
			if hook != nil {
				hook(line)
			}
		}
	}
	wg.Add(2)
	go scan(stdout)
	go scan(stderr)
	waitErr := cmd.Wait()
	wg.Wait()
	out := buf.String()
	if ctx.Err() != nil {
		return out, ctx.Err()
	}
	if waitErr != nil {
		return out, fmt.Errorf("%s: %w", name, waitErr)
	}
	return out, nil
}

func openFirstURLHook() func(string) {
	var once sync.Once
	re := regexp.MustCompile(`https?://[^\s<>\"]+`)
	return func(line string) {
		u := strings.TrimRight(re.FindString(line), ".,);]")
		if u != "" {
			once.Do(func() { appendLog("Відкриваю URL авторизації: " + u); openURL(u) })
		}
	}
}

func cmdQuote(s string) string { return "\"" + strings.ReplaceAll(s, "\"", "") + "\"" }
func shQuote(s string) string  { return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'" }

func lastUsefulLine(s string) string {
	ls := strings.Split(strings.TrimSpace(s), "\n")
	for i := len(ls) - 1; i >= 0; i-- {
		if strings.TrimSpace(ls[i]) != "" {
			return strings.TrimSpace(ls[i])
		}
	}
	return ""
}

func lastURLMatching(s string, re *regexp.Regexp) string {
	xs := re.FindAllString(s, -1)
	if len(xs) == 0 {
		return ""
	}
	return strings.TrimRight(xs[len(xs)-1], ".,);]")
}

// vercelStableURL prefers the production alias printed by Vercel ("Aliased")
// over the deployment-specific URL. The alias survives redeploys and is the
// correct address to wire into Cloudflare.
func vercelStableURL(out string) string {
	urlRe := regexp.MustCompile(`https://[A-Za-z0-9.-]+\.vercel\.app`)
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(strings.ToLower(line), "aliased") {
			if u := urlRe.FindString(line); u != "" {
				return strings.TrimRight(u, ".,);]")
			}
		}
	}
	for _, line := range strings.Split(out, "\n") {
		if strings.Contains(strings.ToLower(line), "production") {
			if u := urlRe.FindString(line); u != "" {
				return strings.TrimRight(u, ".,);]")
			}
		}
	}
	return lastURLMatching(out, urlRe)
}

// cloudflarePagesStableURL extracts the actual *.pages.dev project hostname.
// Cloudflare Pages hostnames are globally unique and may differ from the project
// name (for example project "myster-anime" can become "myster-anime-all.pages.dev").
func cloudflarePagesStableURL(createOut, deployOut string) string {
	stableRe := regexp.MustCompile(`https://([A-Za-z0-9-]+)\.pages\.dev`)
	if m := stableRe.FindStringSubmatch(createOut); len(m) == 2 {
		return "https://" + m[1] + ".pages.dev"
	}
	previewRe := regexp.MustCompile(`https://([A-Za-z0-9-]+)\.([A-Za-z0-9-]+)\.pages\.dev`)
	if m := previewRe.FindStringSubmatch(deployOut); len(m) == 3 {
		return "https://" + m[2] + ".pages.dev"
	}
	if m := stableRe.FindStringSubmatch(deployOut); len(m) == 2 {
		return "https://" + m[1] + ".pages.dev"
	}
	return ""
}

func extractJWT(out string) string {
	re := regexp.MustCompile(`[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`)
	if s := re.FindString(out); s != "" {
		return s
	}
	for _, line := range strings.Split(out, "\n") {
		t := strings.TrimSpace(line)
		if len(t) > 80 && !strings.Contains(t, " ") && !strings.Contains(t, "://") {
			return t
		}
	}
	return ""
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	const hx = "0123456789abcdef"
	out := make([]byte, n*2)
	for i, v := range b {
		out[i*2] = hx[v>>4]
		out[i*2+1] = hx[v&15]
	}
	return string(out)
}

func verifySiteCoreWiring(siteURL, coreURL string) error {
	siteURL = strings.TrimRight(strings.TrimSpace(siteURL), "/")
	coreURL = strings.TrimRight(strings.TrimSpace(coreURL), "/")
	if siteURL == "" || coreURL == "" {
		return errors.New("порожній Site URL або Core URL")
	}
	c := &http.Client{Timeout: 20 * time.Second}
	resp, err := c.Get(siteURL + "/api/version")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("/api/version HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var v struct {
		PythonCoreSearch        string `json:"pythonCoreSearch"`
		PythonCoreProcessStream string `json:"pythonCoreProcessStream"`
		PythonCoreProcessFull   string `json:"pythonCoreProcessFull"`
	}
	if err := json.Unmarshal(body, &v); err != nil {
		return fmt.Errorf("невалідний JSON /api/version: %w", err)
	}
	expected := map[string]string{
		"CORE_SEARCH_URL":         coreURL + "/api/search",
		"CORE_PROCESS_STREAM_URL": coreURL + "/api/process-stream",
		"CORE_PROCESS_FULL_URL":   coreURL + "/api/process-full",
	}
	actual := map[string]string{
		"CORE_SEARCH_URL":         strings.TrimRight(v.PythonCoreSearch, "/"),
		"CORE_PROCESS_STREAM_URL": strings.TrimRight(v.PythonCoreProcessStream, "/"),
		"CORE_PROCESS_FULL_URL":   strings.TrimRight(v.PythonCoreProcessFull, "/"),
	}
	for k, want := range expected {
		if got := actual[k]; got != want {
			return fmt.Errorf("%s не співпадає: site=%q, expected=%q", k, got, want)
		}
	}
	return nil
}

func waitHTTP(url string, attempts int, delay time.Duration) error {
	c := &http.Client{Timeout: 20 * time.Second}
	var last string
	for i := 0; i < attempts; i++ {
		resp, err := c.Get(url)
		if err == nil {
			b, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
			_ = resp.Body.Close()
			last = fmt.Sprintf("HTTP %d %s", resp.StatusCode, strings.TrimSpace(string(b)))
			appendLog("GET " + url + " -> HTTP " + strconv.Itoa(resp.StatusCode))
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
		} else {
			last = err.Error()
		}
		time.Sleep(delay)
	}
	return errors.New(last)
}

func openURL(url string) {
	if strings.TrimSpace(url) == "" {
		return
	}
	procShellExecuteW.Call(0, uintptr(unsafe.Pointer(p16("open"))), uintptr(unsafe.Pointer(p16(url))), 0, 0, SW_SHOWNORMAL)
}

func openFolder(path string) {
	procShellExecuteW.Call(0, uintptr(unsafe.Pointer(p16("open"))), uintptr(unsafe.Pointer(p16("explorer.exe"))), uintptr(unsafe.Pointer(p16("\""+path+"\""))), 0, SW_SHOWNORMAL)
}

func copyText(s string) {
	if s == "" {
		return
	}
	utf := syscall.StringToUTF16(s)
	size := uintptr(len(utf) * 2)
	h, _, _ := procGlobalAlloc.Call(0x0002, size)
	if h == 0 {
		return
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		return
	}
	dst := unsafe.Slice((*uint16)(unsafe.Pointer(p)), len(utf))
	copy(dst, utf)
	procGlobalUnlock.Call(h)
	if r, _, _ := procOpenClipboard.Call(ui.hwnd); r == 0 {
		return
	}
	defer procCloseClipboard.Call()
	procEmptyClipboard.Call()
	procSetClipboardData.Call(13, h) // CF_UNICODETEXT
	setStatus("Скопійовано")
}

func readClipboardText() (string, error) {
	if r, _, _ := procOpenClipboard.Call(ui.hwnd); r == 0 {
		return "", errors.New("не вдалося відкрити буфер обміну")
	}
	defer procCloseClipboard.Call()
	h, _, _ := procGetClipboardData.Call(CF_UNICODETEXT)
	if h == 0 {
		return "", errors.New("у буфері обміну немає тексту")
	}
	p, _, _ := procGlobalLock.Call(h)
	if p == 0 {
		return "", errors.New("не вдалося прочитати буфер обміну")
	}
	defer procGlobalUnlock.Call(h)
	var u16 []uint16
	for i := 0; i < 1024*1024; i++ {
		v := *(*uint16)(unsafe.Pointer(p + uintptr(i*2)))
		if v == 0 {
			break
		}
		u16 = append(u16, v)
	}
	return string(utf16.Decode(u16)), nil
}

func extractTursoPlatformToken(text string) string {
	t := strings.TrimSpace(text)
	if t == "" {
		return ""
	}
	re := regexp.MustCompile(`(?i)TURSO_API_TOKEN\s*=\s*["']?([^"'\s]+)`)
	if m := re.FindStringSubmatch(t); len(m) == 2 {
		return strings.TrimSpace(m[1])
	}
	jwt := regexp.MustCompile(`[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`)
	if m := jwt.FindString(t); m != "" {
		return m
	}
	if !strings.ContainsAny(t, " \t\r\n") && len(t) >= 24 {
		return strings.Trim(t, `"'`)
	}
	return ""
}

func redactCommand(s string) string {
	if current.TursoPlatformToken != "" {
		s = strings.ReplaceAll(s, current.TursoPlatformToken, "<TURSO_API_TOKEN>")
	}
	if current.TursoToken != "" {
		s = strings.ReplaceAll(s, current.TursoToken, "<TURSO_AUTH_TOKEN>")
	}
	if current.CoreKey != "" {
		s = strings.ReplaceAll(s, current.CoreKey, "<CORE_API_KEY>")
	}
	return s
}

func redactLine(s string) string {
	if current.TursoPlatformToken != "" {
		s = strings.ReplaceAll(s, current.TursoPlatformToken, "<TURSO_API_TOKEN>")
	}
	if current.TursoToken != "" {
		s = strings.ReplaceAll(s, current.TursoToken, "<TURSO_AUTH_TOKEN>")
	}
	if current.CoreKey != "" {
		s = strings.ReplaceAll(s, current.CoreKey, "<CORE_API_KEY>")
	}
	// Generic JWT protection: never let freshly-created DB tokens leak into log before state is updated.
	jwt := regexp.MustCompile(`[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`)
	s = jwt.ReplaceAllString(s, "<JWT_REDACTED>")
	return s
}

func saveState() {
	st := stateFile{
		Version: 3, ProjectName: current.ProjectName, Step: current.Step, CloudflareProject: current.CloudflareProject, CloudflareAccount: current.CloudflareAccount,
		VercelProject: current.VercelProject, VercelAccount: current.VercelAccount, TursoDB: current.TursoDB, TursoAccount: current.TursoAccount,
		GitHubAccount: current.GitHubAccount, SiteURL: current.SiteURL, CoreURL: current.CoreURL, TursoURL: current.TursoURL,
		UpdatedAt: time.Now().Format(time.RFC3339),
	}
	if current.TursoToken != "" {
		if s, err := dpapiProtect(current.TursoToken); err == nil {
			st.TursoTokenDPAPI = s
		}
	}
	if current.TursoPlatformToken != "" {
		if s, err := dpapiProtect(current.TursoPlatformToken); err == nil {
			st.TursoPlatformTokenDPAPI = s
		}
	}
	if current.CoreKey != "" {
		if s, err := dpapiProtect(current.CoreKey); err == nil {
			st.CoreKeyDPAPI = s
		}
	}
	b, _ := json.MarshalIndent(st, "", "  ")
	tmp := statePath + ".tmp"
	if os.WriteFile(tmp, b, 0600) == nil {
		_ = os.Rename(tmp, statePath)
	}
}

func loadState() runtimeState {
	var r runtimeState
	b, err := os.ReadFile(statePath)
	if err != nil {
		return r
	}
	var st stateFile
	if json.Unmarshal(b, &st) != nil {
		return r
	}
	r.Step = st.Step
	r.ProjectName = st.ProjectName
	r.CloudflareProject = st.CloudflareProject
	r.CloudflareAccount = st.CloudflareAccount
	r.VercelProject = st.VercelProject
	r.VercelAccount = st.VercelAccount
	r.TursoDB = st.TursoDB
	r.TursoAccount = st.TursoAccount
	r.GitHubAccount = st.GitHubAccount
	r.SiteURL = st.SiteURL
	r.CoreURL = st.CoreURL
	r.TursoURL = st.TursoURL
	if st.TursoTokenDPAPI != "" {
		r.TursoToken, _ = dpapiUnprotect(st.TursoTokenDPAPI)
	}
	if st.TursoPlatformTokenDPAPI != "" {
		r.TursoPlatformToken, _ = dpapiUnprotect(st.TursoPlatformTokenDPAPI)
	}
	if st.CoreKeyDPAPI != "" {
		r.CoreKey, _ = dpapiUnprotect(st.CoreKeyDPAPI)
	}
	if r.ProjectName == "" && st.Version >= 3 && r.CloudflareProject != "" && r.CloudflareProject == r.VercelProject && r.VercelProject == r.TursoDB {
		r.ProjectName = r.CloudflareProject
	}
	return r
}

func dpapiProtect(s string) (string, error) {
	inBytes := []byte(s)
	if len(inBytes) == 0 {
		return "", nil
	}
	in := dataBlob{cbData: uint32(len(inBytes)), pbData: &inBytes[0]}
	var out dataBlob
	r, _, e := procCryptProtectData.Call(uintptr(unsafe.Pointer(&in)), 0, 0, 0, 0, CRYPTPROTECT_UI_FORBIDDEN, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		return "", e
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))
	data := unsafe.Slice(out.pbData, int(out.cbData))
	cp := append([]byte(nil), data...)
	return base64.StdEncoding.EncodeToString(cp), nil
}

func dpapiUnprotect(s string) (string, error) {
	enc, err := base64.StdEncoding.DecodeString(s)
	if err != nil || len(enc) == 0 {
		return "", err
	}
	in := dataBlob{cbData: uint32(len(enc)), pbData: &enc[0]}
	var out dataBlob
	r, _, e := procCryptUnprotectData.Call(uintptr(unsafe.Pointer(&in)), 0, 0, 0, 0, CRYPTPROTECT_UI_FORBIDDEN, uintptr(unsafe.Pointer(&out)))
	if r == 0 {
		return "", e
	}
	defer procLocalFree.Call(uintptr(unsafe.Pointer(out.pbData)))
	data := unsafe.Slice(out.pbData, int(out.cbData))
	return string(append([]byte(nil), data...)), nil
}
