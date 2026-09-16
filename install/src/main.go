//go:build windows

package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
	appVersion          = "1.4.0"
	vercelCLIVersion    = "59.19.0"
	wranglerVersion     = "4.132.0"
	nodeVersion         = "24.21.0"
	githubCLIVersion    = "2.101.0"
	gitVersion          = "2.55.0.5"
	yoruWSLDistroPrefix = "YORU-Ubuntu"
	ubuntuRootfsURL     = "https://cloud-images.ubuntu.com/wsl/releases/24.04/current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz"
	wslLatestReleaseAPI = "https://api.github.com/repos/microsoft/WSL/releases/latest"

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
	CTRL_GITHUB_SIGNUP = 1010
	CTRL_AUTH_REFRESH  = 1011
	CTRL_CHECK_PROJECT = 1012

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
	hwnd       uintptr
	hFont      uintptr
	logEdit    uintptr
	stepList   uintptr
	status     uintptr
	startBtn   uintptr
	stopBtn    uintptr
	fields     map[int]uintptr
	copies     map[int]int
	authStatus map[string]uintptr
	authCode   map[string]uintptr
}

var (
	ui          appUI
	appRoot     string
	installDir  string
	dataRoot    string
	statePath   string
	logPath     string
	logFile     *os.File
	logMu       sync.Mutex
	runMu       sync.Mutex
	running     bool
	cancelRun   context.CancelFunc
	authMu      sync.Mutex
	authRunning bool
	current     runtimeState
	wslDistro   string

	uiQueueMu    sync.Mutex
	uiQueue      []func()
	uiPumpPosted bool
)

var steps = []string{
	"1. GitHub + структура проєкту та інструменти",
	"2. Cloudflare: авторизація + перевірка назви",
	"3. Vercel: авторизація",
	"4. Turso: авторизація",
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
		case CTRL_GITHUB_SIGNUP:
			go interactiveAuthorizeService("github")
		case CTRL_CF_SIGNUP:
			go interactiveAuthorizeService("cloudflare")
		case CTRL_VERCEL_SIGNUP:
			go interactiveAuthorizeService("vercel")
		case CTRL_TURSO_SIGNUP:
			go interactiveAuthorizeService("turso")
		case CTRL_AUTH_REFRESH:
			go refreshAuthorizationPanel()
		case CTRL_CHECK_PROJECT:
			raw := getText(ui.fields[CTRL_CF_PROJECT])
			go interactiveCheckProjectName(raw)
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
	dataRoot = filepath.Join(installDir, "data")
	if err = ensureDataLayout(); err != nil {
		panic(err)
	}
	configureIsolatedEnvironment()
	appRoot = findProjectRoot()
	if appRoot == "" {
		appRoot = filepath.Join(dataRoot, "project", "Anime-catalog")
	}
	statePath = filepath.Join(dataRoot, "state", "installer-state.json")
	logPath = filepath.Join(dataRoot, "logs", "install-"+time.Now().Format("20060102-150405")+".log")
	logFile, _ = os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if logFile != nil {
		defer logFile.Close()
	}

	current = loadState()
	if current.ProjectName == "" {
		clearDeploymentWiring(false)
	}

	createMainWindow()
	appendLog("YORU Installer v" + appVersion)
	appendLog("Data root: " + dataRoot)
	appendLog("Project root: " + appRoot + " (репозиторій завжди зберігається у data\\project)")
	appendLog("State: " + statePath)
	appendLog("Tools/auth/cache/Ubuntu/репозиторій ізольовані всередині data.")
	appendLog("Secrets у state-файлі зберігаються через Windows DPAPI.")
	refreshUIFromState()
	go refreshAuthorizationPanel()

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
	hwnd, _, _ := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(p16("YORU Installer — автоматичне розгортання"))), style, 80, 40, 1220, 900, 0, 0, hInst, 0)
	ui.hwnd = hwnd

	font, _, _ := procCreateFontW.Call(18, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, uintptr(unsafe.Pointer(p16("Segoe UI"))))
	ui.hFont = font
	ui.fields = map[int]uintptr{}
	ui.copies = map[int]int{}
	ui.authStatus = map[string]uintptr{}
	ui.authCode = map[string]uintptr{}

	label(hwnd, "Етапи встановлення", 18, 16, 420, 24)
	ui.stepList = control("LISTBOX", "", WS_CHILD|WS_VISIBLE|WS_BORDER|WS_VSCROLL|LBS_NOTIFY|LBS_NOINTEGRALHEIGHT, 18, 44, 705, 190, hwnd, 1301)

	label(hwnd, "Лог", 18, 244, 100, 24)
	ui.logEdit = control("EDIT", "", WS_CHILD|WS_VISIBLE|WS_BORDER|WS_VSCROLL|WS_HSCROLL|ES_LEFT|ES_MULTILINE|ES_AUTOVSCROLL|ES_AUTOHSCROLL|ES_READONLY, 18, 272, 705, 500, hwnd, 1302)

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

	label(hwnd, "Авторизація сервісів", 748, 570, 250, 20)
	button(hwnd, "Оновити статус", 1040, 566, 132, 27, CTRL_AUTH_REFRESH, false)
	addAuthRow("github", "GitHub", CTRL_GITHUB_SIGNUP, 594)
	addAuthRow("cloudflare", "Cloudflare", CTRL_CF_SIGNUP, 642)
	addAuthRow("vercel", "Vercel", CTRL_VERCEL_SIGNUP, 690)
	addAuthRow("turso", "Turso", CTRL_TURSO_SIGNUP, 738)

	ui.startBtn = button(hwnd, "Почати / продовжити", 18, 800, 190, 36, CTRL_START, true)
	ui.stopBtn = button(hwnd, "Зупинити", 218, 800, 110, 36, CTRL_STOP, false)
	button(hwnd, "Відкрити сайт", 338, 800, 120, 36, CTRL_OPEN_SITE, false)
	button(hwnd, "Core health", 468, 800, 110, 36, CTRL_OPEN_CORE, false)
	button(hwnd, "Tampermonkey", 588, 800, 125, 36, CTRL_TAMPER, false)
	button(hwnd, "Extension", 748, 800, 105, 36, CTRL_EXTENSION, false)

	ui.status = label(hwnd, "Готово до запуску", 870, 804, 305, 28)

	for _, st := range steps {
		procSendMessageW.Call(ui.stepList, LB_ADDSTRING, 0, uintptr(unsafe.Pointer(p16("○ "+st))))
	}
	refreshAuthStatusFromStateDirect()
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
	if id == CTRL_CF_PROJECT {
		button(ui.hwnd, "Перевірити", x+372, y+22, 88, 28, CTRL_CHECK_PROJECT, false)
		return
	}
	copyID := CTRL_COPY_BASE + len(ui.copies) + 1
	button(ui.hwnd, "Копіювати", x+372, y+22, 88, 28, copyID, false)
	ui.copies[copyID] = id
}

func addAuthRow(service, title string, buttonID, y int) {
	button(ui.hwnd, title, 748, y, 112, 38, buttonID, false)
	h := control("STATIC", "Потрібна авторизація", WS_CHILD|WS_VISIBLE, 874, y, 298, 20, ui.hwnd, 0)
	ui.authStatus[service] = h
	codeStyle := uintptr(WS_CHILD | WS_VISIBLE | WS_BORDER | ES_READONLY | ES_AUTOHSCROLL)
	c := control("EDIT", "Код: —", codeStyle, 874, y+20, 298, 22, ui.hwnd, 0)
	ui.authCode[service] = c
}

func authDisplay(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "Потрібна авторизація"
	}
	return "✓ " + value
}

func setAuthStatusDirect(service, value string) {
	if ui.authStatus == nil {
		return
	}
	if h := ui.authStatus[service]; h != 0 {
		setText(h, value)
	}
}

func setAuthStatus(service, value string) {
	postUI(func() { setAuthStatusDirect(service, value) })
}

func setAuthCodeDirect(service, code string) {
	if ui.authCode == nil {
		return
	}
	text := "Код: —"
	if strings.TrimSpace(code) != "" {
		text = "Код: " + strings.TrimSpace(code)
	}
	if h := ui.authCode[service]; h != 0 {
		setText(h, text)
	}
}

func setAuthCode(service, code string) {
	postUI(func() { setAuthCodeDirect(service, code) })
}

func refreshAuthStatusFromStateDirect() {
	setAuthStatusDirect("github", authDisplay(current.GitHubAccount))
	setAuthStatusDirect("cloudflare", authDisplay(current.CloudflareAccount))
	setAuthStatusDirect("vercel", authDisplay(current.VercelAccount))
	setAuthStatusDirect("turso", authDisplay(current.TursoAccount))
	setAuthCodeDirect("github", "")
	setAuthCodeDirect("cloudflare", "")
	setAuthCodeDirect("vercel", "")
	setAuthCodeDirect("turso", "")
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
	refreshAuthStatusFromStateDirect()
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
	for _, name := range []string{"vercel", "core"} {
		p := filepath.Join(path, name)
		if st, err := os.Stat(p); err == nil && st.IsDir() {
			return p
		}
	}
	return filepath.Join(path, "vercel")
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
	if dataRoot == "" {
		return ""
	}
	candidate := filepath.Join(dataRoot, "project", "Anime-catalog")
	if isProjectRoot(candidate) {
		return candidate
	}
	return ""
}

func addCommonToolPaths() {
	if dataRoot == "" {
		return
	}
	paths := []string{
		filepath.Join(dataRoot, "tools", "node"),
		filepath.Join(dataRoot, "tools", "git", "cmd"),
		filepath.Join(dataRoot, "tools", "git", "mingw64", "bin"),
		filepath.Join(dataRoot, "tools", "gh", "bin"),
		filepath.Join(dataRoot, "tools", "gh"),
	}
	old := os.Getenv("PATH")
	for i := len(paths) - 1; i >= 0; i-- {
		p := paths[i]
		if p == "" || strings.Contains(strings.ToLower(old), strings.ToLower(p)) {
			continue
		}
		old = p + ";" + old
	}
	_ = os.Setenv("PATH", old)
}

func findTool(name string) string {
	addCommonToolPaths()
	if p, err := exec.LookPath(name); err == nil {
		clean, _ := filepath.Abs(p)
		if dataRoot == "" || strings.HasPrefix(strings.ToLower(clean), strings.ToLower(filepath.Clean(dataRoot)+string(os.PathSeparator))) {
			return p
		}
	}
	return ""
}

func ensureWindowsTool(ctx context.Context, exeName, wingetID, friendly, url string) (string, error) {
	switch strings.ToLower(exeName) {
	case "gh.exe", "gh":
		if err := ensurePortableGit(ctx); err != nil {
			return "", err
		}
		if err := ensurePortableGitHubCLI(ctx); err != nil {
			return "", err
		}
		return ghExePath(), nil
	case "git.exe", "git":
		if err := ensurePortableGit(ctx); err != nil {
			return "", err
		}
		return gitExePath(), nil
	case "node.exe", "node":
		if err := ensurePortableNode(ctx); err != nil {
			return "", err
		}
		return nodeExePath(), nil
	}
	return "", fmt.Errorf("%s не підтримується як portable tool", friendly)
}

func ensureProject(ctx context.Context) error {
	if err := ensurePortableNode(ctx); err != nil {
		return err
	}
	if err := ensurePortableGit(ctx); err != nil {
		return err
	}
	if err := ensurePortableGitHubCLI(ctx); err != nil {
		return err
	}
	gh := ghExePath()
	if err := ensureGitHubAccount(ctx, gh); err != nil {
		return err
	}
	_, _ = runDirect(ctx, dataRoot, "", nil, gh, "auth", "setup-git", "--hostname", "github.com")

	if root := findProjectRoot(); root != "" {
		appRoot = root
		setFieldText(CTRL_ROOT, appRoot)
		appendLog("Проєкт знайдено у data: " + appRoot)
		return nil
	}

	target := filepath.Join(dataRoot, "project", "Anime-catalog")
	appRoot = target
	setFieldText(CTRL_ROOT, appRoot)
	appendLog("Проєкт не знайдено. Клоную MysterSay/Anime-catalog у data\\project: " + target)
	if st, statErr := os.Stat(target); statErr == nil && st.IsDir() {
		entries, _ := os.ReadDir(target)
		if len(entries) > 0 {
			return fmt.Errorf("папка %s вже існує і не схожа на Anime-catalog; очисти data\\project\\Anime-catalog", target)
		}
	}
	_ = os.MkdirAll(filepath.Dir(target), 0755)
	appendLog("> gh repo clone MysterSay/Anime-catalog " + target)
	_, cloneErr := runDirect(ctx, dataRoot, "", nil, gh, "repo", "clone", "MysterSay/Anime-catalog", target)
	if cloneErr != nil {
		return fmt.Errorf("gh repo clone MysterSay/Anime-catalog: %w", cloneErr)
	}
	if !isProjectRoot(target) {
		return fmt.Errorf("репозиторій клоновано, але структура Anime-catalog неповна: %s", target)
	}
	appRoot = target
	setFieldText(CTRL_ROOT, appRoot)
	appendLog("Проєкт успішно клоновано всередину data. Продовжую без перезапуску.")
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
			return fmt.Errorf("після клонування не знайдено папку %s", p)
		}
	}
	corePath := projectCoreDir(appRoot)
	if st, err := os.Stat(corePath); err != nil || !st.IsDir() {
		return fmt.Errorf("після клонування не знайдено папку ядра %s", corePath)
	}
	appendLog("Структура проєкту: OK")
	if err := ensurePortableNode(ctx); err != nil {
		return err
	}
	if err := ensureWranglerCLI(ctx, filepath.Join(appRoot, "site")); err != nil {
		return err
	}
	if err := ensureVercelCLI(ctx, corePath); err != nil {
		return err
	}
	appendLog("Portable Node.js / Wrangler / Vercel: OK; усе знаходиться у data\\tools")
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
	for attempt := 1; attempt <= 4; attempt++ {
		out, err := runWrangler(ctx, siteDir, "", nil, "whoami")
		if err == nil && strings.Contains(strings.ToLower(out), "logged in") {
			current.CloudflareAccount = cloudflareAccountLabel(out)
			if current.CloudflareAccount == "" {
				current.CloudflareAccount = "Cloudflare OAuth"
			}
			setAuthStatus("cloudflare", authDisplay(current.CloudflareAccount))
			setAuthCode("cloudflare", "")
			saveState()
			appendLog("Cloudflare active identity: " + current.CloudflareAccount)
			return nil
		}

		setAuthStatus("cloudflare", "Потрібна авторизація")
		messageSync("Cloudflare CLI не авторизований. Зараз відкриється OAuth/device login. Увійди в потрібний акаунт — окремого підтвердження «це той акаунт?» більше не буде; активний акаунт завжди видно праворуч у блоці авторизації.", "Cloudflare — потрібна авторизація", MB_OK|MB_ICONINFORMATION)
		openURL("https://dash.cloudflare.com/")
		if _, err = runWrangler(ctx, siteDir, "", authorizationFlowHook("cloudflare"), "login", "--device"); err != nil {
			return fmt.Errorf("Cloudflare login: %w", err)
		}
	}
	return errors.New("Cloudflare: не вдалося підтвердити авторизацію після login")
}

func vercelToolRoot() string { return filepath.Join(dataRoot, "tools", "vercel") }

func vercelToolPath() string {
	return filepath.Join(vercelToolRoot(), "node_modules", ".bin", "vercel.cmd")
}

func vercelEntryPath() string {
	return filepath.Join(vercelToolRoot(), "node_modules", "vercel", "dist", "index.js")
}

func vercelNPMCacheDir() string { return filepath.Join(dataRoot, "cache", "npm") }

func runVercel(ctx context.Context, dir, stdin string, hook func(string), args ...string) (string, error) {
	entry := vercelEntryPath()
	if _, err := os.Stat(entry); err != nil {
		return "", fmt.Errorf("Vercel CLI entrypoint не знайдено: %s", entry)
	}
	allArgs := []string{entry, "--global-config", vercelGlobalConfigDir()}
	allArgs = append(allArgs, args...)
	appendLog("> node " + redactCommand(joinArgsForLog(allArgs...)))
	return runDirect(ctx, dir, stdin, hook, nodeExePath(), allArgs...)
}

func ensureVercelCLI(ctx context.Context, coreDir string) error {
	if err := ensurePortableNode(ctx); err != nil {
		return err
	}
	entry := vercelEntryPath()
	if _, err := os.Stat(entry); err == nil {
		if out, verr := runVercel(ctx, coreDir, "", nil, "--version"); verr == nil && strings.Contains(strings.ToLower(out), "vercel") {
			appendLog("Vercel CLI: OK (data\\tools\\vercel)")
			return nil
		}
		appendLog("Portable Vercel CLI пошкоджений; перевстановлюю в data\\tools\\vercel.")
		_ = os.RemoveAll(vercelToolRoot())
	}
	_ = os.MkdirAll(vercelToolRoot(), 0755)
	_ = os.MkdirAll(vercelNPMCacheDir(), 0755)
	appendLog("Встановлюю Vercel CLI " + vercelCLIVersion + " у data\\tools\\vercel ...")
	if err := installNPMDirect(ctx, vercelToolRoot(), "vercel@"+vercelCLIVersion); err != nil {
		return fmt.Errorf("встановлення portable Vercel CLI: %w", err)
	}
	if _, err := os.Stat(entry); err != nil {
		return fmt.Errorf("Vercel CLI встановлено, але entrypoint %s не знайдено", entry)
	}
	out, err := runVercel(ctx, coreDir, "", nil, "--version")
	if err != nil {
		return fmt.Errorf("перевірка Vercel CLI: %w", err)
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

	for attempt := 1; attempt <= 4; attempt++ {
		out, err := runVercel(ctx, coreDir, "", nil, "whoami")
		if err == nil {
			username := strings.TrimSpace(lastUsefulLine(out))
			if username != "" && !vercelAuthMissing(out) {
				current.VercelAccount = username
				setAuthStatus("vercel", authDisplay(username))
				setAuthCode("vercel", "")
				saveState()
				appendLog("Vercel active identity: " + username)
				return nil
			}
		}
		if err != nil && !vercelAuthMissing(out) {
			return fmt.Errorf("Vercel CLI technical error during whoami: %w", err)
		}

		setAuthStatus("vercel", "Потрібна авторизація")
		messageSync("Vercel CLI не має активної авторизації. Зараз відкриється login. Увійди в потрібний акаунт; після входу username автоматично з'явиться у блоці авторизації.", "Vercel — потрібна авторизація", MB_OK|MB_ICONINFORMATION)
		openURL("https://vercel.com/login")
		if _, err = runVercel(ctx, coreDir, "", authorizationFlowHook("vercel"), "login"); err != nil {
			return fmt.Errorf("Vercel login: %w", err)
		}
	}
	return errors.New("Vercel: не вдалося підтвердити авторизацію після login")
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

type tursoOrganizationAPI struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
	Type string `json:"type"`
}

type tursoGroupAPI struct {
	Name string `json:"name"`
}

type tursoDatabaseAPI struct {
	DbID     string `json:"DbId"`
	Hostname string `json:"Hostname"`
	Name     string `json:"Name"`
}

func tursoPlatformRequest(ctx context.Context, token, method, path string, body any) (int, []byte, error) {
	endpoint := "https://api.turso.tech" + path
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		reader = bytes.NewReader(payload)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(token) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return resp.StatusCode, nil, err
	}
	return resp.StatusCode, data, nil
}

func tursoAPIError(status int, body []byte) error {
	text := strings.TrimSpace(string(body))
	if len(text) > 700 {
		text = text[:700]
	}
	if text == "" {
		text = http.StatusText(status)
	}
	return fmt.Errorf("Turso Platform API HTTP %d: %s", status, text)
}

func tursoIdentityFromToken(ctx context.Context, token string) (string, []tursoOrganizationAPI, error) {
	if strings.TrimSpace(token) == "" {
		return "", nil, errors.New("Turso Platform API token відсутній")
	}
	status, body, err := tursoPlatformRequest(ctx, token, http.MethodGet, "/v1/auth/validate", nil)
	if err != nil {
		return "", nil, err
	}
	if status != http.StatusOK {
		return "", nil, tursoAPIError(status, body)
	}
	status, body, err = tursoPlatformRequest(ctx, token, http.MethodGet, "/v1/organizations", nil)
	if err != nil {
		return "", nil, err
	}
	if status != http.StatusOK {
		return "", nil, tursoAPIError(status, body)
	}
	var orgs []tursoOrganizationAPI
	if err := json.Unmarshal(body, &orgs); err != nil {
		return "", nil, fmt.Errorf("Turso organizations JSON: %w", err)
	}
	if len(orgs) == 0 {
		return "", nil, errors.New("Turso API token валідний, але акаунт не має organization")
	}
	chosen := orgs[0].Slug
	for _, org := range orgs {
		if strings.EqualFold(org.Type, "personal") && strings.TrimSpace(org.Slug) != "" {
			chosen = org.Slug
			break
		}
	}
	if strings.TrimSpace(chosen) == "" {
		return "", nil, errors.New("Turso organization slug порожній")
	}
	return chosen, orgs, nil
}

func tursoEnsureGroup(ctx context.Context, token, org string) (string, error) {
	base := "/v1/organizations/" + url.PathEscape(org)
	status, body, err := tursoPlatformRequest(ctx, token, http.MethodGet, base+"/groups", nil)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", tursoAPIError(status, body)
	}
	var listing struct {
		Groups []tursoGroupAPI `json:"groups"`
	}
	if err := json.Unmarshal(body, &listing); err != nil {
		return "", fmt.Errorf("Turso groups JSON: %w", err)
	}
	for _, g := range listing.Groups {
		if strings.EqualFold(g.Name, "default") {
			return g.Name, nil
		}
	}
	if len(listing.Groups) > 0 && strings.TrimSpace(listing.Groups[0].Name) != "" {
		return listing.Groups[0].Name, nil
	}

	status, body, err = tursoPlatformRequest(ctx, token, http.MethodGet, "/v1/locations", nil)
	if err != nil {
		return "", err
	}
	if status != http.StatusOK {
		return "", tursoAPIError(status, body)
	}
	var locs struct {
		Locations map[string]string `json:"locations"`
	}
	if err := json.Unmarshal(body, &locs); err != nil {
		return "", fmt.Errorf("Turso locations JSON: %w", err)
	}
	location := ""
	for _, preferred := range []string{"aws-eu-west-1", "fra", "lhr", "ams"} {
		if _, ok := locs.Locations[preferred]; ok {
			location = preferred
			break
		}
	}
	if location == "" {
		for code := range locs.Locations {
			location = code
			break
		}
	}
	if location == "" {
		return "", errors.New("Turso не повернув жодної доступної location")
	}
	appendLog("Turso: створюю group default у location " + location)
	status, body, err = tursoPlatformRequest(ctx, token, http.MethodPost, base+"/groups", map[string]any{"name": "default", "location": location})
	if err != nil {
		return "", err
	}
	if status != http.StatusOK && status != http.StatusConflict {
		return "", tursoAPIError(status, body)
	}
	return "default", nil
}

func acquireTursoPlatformToken(ctx context.Context, signup bool) error {
	current.TursoPlatformToken = ""
	current.TursoAccount = ""
	setAuthStatus("turso", "Авторизація...")
	openURL("https://app.turso.tech/")
	messageSync("У браузері увійди або зареєструйся в Turso.\n\nПотім у Turso Dashboard відкрий Account/Organization settings -> API Tokens, створи Platform API Token (наприклад `yoru-installer`) і натисни Copy.\n\nПовернись у YORU Installer та натисни OK. Installer сам прочитає token із буфера обміну. WSL, Ubuntu і Turso CLI більше НЕ потрібні.", "Turso — Platform API Token", MB_OK|MB_ICONINFORMATION)
	for attempt := 1; attempt <= 4; attempt++ {
		clip, cerr := readClipboardText()
		if cerr != nil {
			messageSync("Не вдалося прочитати буфер обміну: "+cerr.Error()+"\n\nСкопіюй Platform API Token у Turso Dashboard і натисни OK.", "Turso", MB_OK|MB_ICONWARNING)
			continue
		}
		token := extractTursoPlatformToken(clip)
		if token == "" {
			messageSync("У буфері обміну не знайдено Turso Platform API Token.\n\nСкопіюй token із Turso Dashboard -> API Tokens і натисни OK.", "Turso", MB_OK|MB_ICONWARNING)
			continue
		}
		org, _, verr := tursoIdentityFromToken(ctx, token)
		if verr == nil {
			current.TursoPlatformToken = token
			current.TursoAccount = org
			setAuthStatus("turso", authDisplay(org))
			setAuthCode("turso", "")
			saveState()
			appendLog("Turso Platform API token перевірено. Organization: " + org + ". Token збережено через Windows DPAPI у data\\state.")
			return nil
		}
		messageSync("Скопійований token не пройшов перевірку Turso Platform API:\n\n"+verr.Error()+"\n\nСтвори/скопіюй Platform API Token ще раз і натисни OK.", "Turso token не прийнято", MB_OK|MB_ICONWARNING)
	}
	return errors.New("Turso: не вдалося отримати валідний Platform API Token з буфера обміну")
}

func ensureTursoAccount(ctx context.Context) error {
	if strings.TrimSpace(current.TursoPlatformToken) != "" {
		org, _, err := tursoIdentityFromToken(ctx, current.TursoPlatformToken)
		if err == nil {
			current.TursoAccount = org
			setAuthStatus("turso", authDisplay(org))
			setAuthCode("turso", "")
			saveState()
			appendLog("Turso active organization: " + org + " (Platform API)")
			return nil
		}
		appendLog("Збережений Turso Platform API token більше не валідний: " + err.Error())
		resetServiceBinding("turso")
	}
	setAuthStatus("turso", "Потрібна авторизація")
	return acquireTursoPlatformToken(ctx, false)
}

func githubIdentity(ctx context.Context, gh string) (string, string, error) {
	out, err := runDirect(ctx, dataRoot, "", nil, gh, "api", "user")
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

func ensureGitHubAccount(ctx context.Context, gh string) error {
	for attempt := 1; attempt <= 4; attempt++ {
		if _, err := runDirect(ctx, dataRoot, "", nil, gh, "auth", "status", "--active", "--hostname", "github.com"); err == nil {
			login, summary, identityErr := githubIdentity(ctx, gh)
			if identityErr == nil && strings.TrimSpace(login) != "" {
				current.GitHubAccount = login
				setAuthStatus("github", authDisplay("@"+login))
				setAuthCode("github", "")
				saveState()
				appendLog("GitHub active identity: " + strings.ReplaceAll(summary, "\n", " | "))
				return nil
			}
		}

		setAuthStatus("github", "Потрібна авторизація")
		messageSync("GitHub CLI не авторизований. Авторизація тепер обов'язкова, тому що installer клонує та перевіряє репозиторій через GitHub CLI. Зараз відкриється GitHub login.", "GitHub — потрібна авторизація", MB_OK|MB_ICONINFORMATION)
		openURL("https://github.com/login")
		if _, err := runDirect(ctx, dataRoot, "", authorizationFlowHook("github"), gh, "auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https", "--insecure-storage"); err != nil {
			return fmt.Errorf("GitHub login: %w", err)
		}
	}
	return errors.New("GitHub: не вдалося підтвердити авторизацію після login")
}

func jsonContainsProjectName(value any, wanted string) bool {
	wanted = strings.ToLower(strings.TrimSpace(wanted))
	switch v := value.(type) {
	case map[string]any:
		for key, raw := range v {
			lk := strings.ToLower(strings.TrimSpace(key))
			if lk == "name" || lk == "project_name" || lk == "projectname" {
				if name, ok := raw.(string); ok && strings.EqualFold(strings.TrimSpace(name), wanted) {
					return true
				}
			}
			if jsonContainsProjectName(raw, wanted) {
				return true
			}
		}
	case []any:
		for _, item := range v {
			if jsonContainsProjectName(item, wanted) {
				return true
			}
		}
	}
	return false
}

func cloudflareProjectExistsInAccount(ctx context.Context, siteDir, name string) (bool, error) {
	out, err := runWrangler(ctx, siteDir, "", nil, "pages", "project", "list", "--json")
	if err == nil {
		clean := regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`).ReplaceAllString(out, "")
		startObj, startArr := strings.Index(clean, "{"), strings.Index(clean, "[")
		start := -1
		if startObj >= 0 && (startArr < 0 || startObj < startArr) {
			start = startObj
		} else if startArr >= 0 {
			start = startArr
		}
		if start >= 0 {
			clean = clean[start:]
			endObj, endArr := strings.LastIndex(clean, "}"), strings.LastIndex(clean, "]")
			end := endObj
			if endArr > end {
				end = endArr
			}
			if end >= 0 {
				clean = clean[:end+1]
			}
			var doc any
			if json.Unmarshal([]byte(clean), &doc) == nil {
				return jsonContainsProjectName(doc, name), nil
			}
		}
	}

	textOut, textErr := runWrangler(ctx, siteDir, "", nil, "pages", "project", "list")
	if textErr != nil {
		if err != nil {
			return false, err
		}
		return false, textErr
	}
	needle := strings.ToLower(strings.TrimSpace(name))
	for _, raw := range strings.Split(strings.ReplaceAll(textOut, "\r", ""), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		parts := regexp.MustCompile(`[\s│|]+`).Split(strings.ToLower(line), -1)
		for _, part := range parts {
			if strings.Trim(part, " \t") == needle {
				return true, nil
			}
		}
	}
	return false, nil
}

func cloudflarePageResponds(ctx context.Context, name string) (bool, int) {
	url := "https://" + name + ".pages.dev/"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return false, 0
	}
	req.Header.Set("User-Agent", "YORU-Installer/"+appVersion)
	client := &http.Client{
		Timeout:       7 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },
	}
	resp, err := client.Do(req)
	if err != nil {
		return false, 0
	}
	defer resp.Body.Close()
	_, _ = io.CopyN(io.Discard, resp.Body, 512)
	if (resp.StatusCode >= 200 && resp.StatusCode < 400) || resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return true, resp.StatusCode
	}
	return false, resp.StatusCode
}

func interactiveCheckProjectName(raw string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		messageSync("Введи назву проєкту, яку потрібно перевірити.", "Перевірка назви", MB_OK|MB_ICONWARNING)
		return
	}
	name := normalizeSharedProjectName(raw)
	if !validSharedProjectName(name) {
		messageSync("Назва має бути 1-48 символів і після нормалізації містити тільки латинські a-z, цифри та дефіси.", "Некоректна назва", MB_OK|MB_ICONWARNING)
		return
	}
	if name != raw {
		setFieldText(CTRL_CF_PROJECT, name)
	}
	setStatus("Перевіряю назву " + name + "...")
	appendLog("Ручна перевірка Cloudflare Pages name: " + name)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	if taken, status := cloudflarePageResponds(ctx, name); taken {
		setStatus("Назва зайнята: " + name)
		messageSync(fmt.Sprintf("Назва «%s» зайнята.\n\nhttps://%s.pages.dev вже відповідає (HTTP %d).\n\nВибери іншу назву проєкту.", name, name, status), "Cloudflare Pages — зайнято", MB_OK|MB_ICONWARNING)
		return
	}

	siteDir := filepath.Join(appRoot, "site")
	if st, err := os.Stat(siteDir); err != nil || !st.IsDir() {
		siteDir = installDir
	}
	who, whoErr := runWrangler(ctx, siteDir, "", nil, "whoami")
	loggedIn := whoErr == nil && strings.Contains(strings.ToLower(who), "logged in")
	if !loggedIn {
		setStatus("URL вільний; потрібна Cloudflare авторизація для повної перевірки")
		messageSync("Точна адреса https://"+name+".pages.dev зараз не зайнята.\n\nАле Cloudflare CLI не авторизований, тому installer не може перевірити список Pages projects активного акаунта.\n\nНатисни кнопку Cloudflare, авторизуйся, а потім натисни «Перевірити» ще раз.", "Cloudflare Pages — часткова перевірка", MB_OK|MB_ICONINFORMATION)
		return
	}

	exists, err := cloudflareProjectExistsInAccount(ctx, siteDir, name)
	if err != nil {
		setStatus("Помилка перевірки назви")
		messageSync("Не вдалося перевірити список Cloudflare Pages projects:\n\n"+err.Error(), "Перевірка назви", MB_OK|MB_ICONERROR)
		return
	}
	if exists && !cloudflareResumeAllowed(name) {
		setStatus("Назва зайнята в Cloudflare: " + name)
		messageSync("Pages project «"+name+"» уже існує в активному Cloudflare-акаунті.\n\nВибери іншу назву, щоб installer не перезаписав існуючий сайт.", "Cloudflare Pages — зайнято", MB_OK|MB_ICONWARNING)
		return
	}
	if exists && cloudflareResumeAllowed(name) {
		setStatus("Існуючий проєкт доступний для resume: " + name)
		messageSync("Pages project «"+name+"» уже існує і відповідає збереженому Site URL цього installer.\n\nНазву можна використовувати для продовження попереднього встановлення.", "Cloudflare Pages — resume", MB_OK|MB_ICONINFORMATION)
		return
	}

	setStatus("Назва вільна: " + name)
	appendLog("Cloudflare Pages manual check: «" + name + "» вільна.")
	messageSync("Назва «"+name+"» вільна.\n\nCloudflare Pages project з такою назвою не знайдено, а https://"+name+".pages.dev не зайнятий.", "Cloudflare Pages — вільно", MB_OK|MB_ICONINFORMATION)
}

func cloudflareResumeAllowed(name string) bool {
	expected := "https://" + strings.ToLower(strings.TrimSpace(name)) + ".pages.dev"
	return strings.EqualFold(strings.TrimRight(strings.TrimSpace(current.SiteURL), "/"), expected) && current.ProjectName == name
}

func ensureCloudflareProjectNameAvailable(ctx context.Context, siteDir string) error {
	name := current.ProjectName
	exists, err := cloudflareProjectExistsInAccount(ctx, siteDir, name)
	if err != nil {
		return fmt.Errorf("не вдалося перевірити список Cloudflare Pages projects: %w", err)
	}
	if exists {
		if cloudflareResumeAllowed(name) {
			appendLog("Cloudflare Pages project «" + name + "» вже існує і відповідає збереженому Site URL — дозволяю resume.")
			return nil
		}
		return fmt.Errorf("Cloudflare Pages project «%s» вже існує в активному акаунті. Щоб installer випадково не перезаписав чужий/старий сайт, введи іншу назву проєкту", name)
	}
	if taken, status := cloudflarePageResponds(ctx, name); taken {
		return fmt.Errorf("адреса https://%s.pages.dev вже відповідає (HTTP %d). Точний Pages slug зайнятий; вибери іншу назву проєкту", name, status)
	}
	appendLog("Cloudflare Pages name preflight: «" + name + "» не знайдено в активному акаунті, точний pages.dev URL не зайнятий.")
	return nil
}

func refreshAuthorizationPanel() {
	runMu.Lock()
	busy := running
	runMu.Unlock()
	if busy {
		return
	}
	setAuthStatus("github", "Перевірка...")
	setAuthStatus("cloudflare", "Перевірка...")
	setAuthStatus("vercel", "Перевірка...")
	setAuthStatus("turso", "Перевірка...")
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	if gh := ghExePath(); fileExists(gh) {
		if _, err := runDirect(ctx, dataRoot, "", nil, gh, "auth", "status", "--active", "--hostname", "github.com"); err == nil {
			if login, _, ierr := githubIdentity(ctx, gh); ierr == nil && login != "" {
				setAuthStatus("github", authDisplay("@"+login))
			} else {
				setAuthStatus("github", "Потрібна авторизація")
			}
		} else {
			setAuthStatus("github", "Потрібна авторизація")
		}
	} else {
		setAuthStatus("github", "Потрібна авторизація")
	}

	siteDir := filepath.Join(appRoot, "site")
	if !dirExists(siteDir) {
		siteDir = dataRoot
	}
	if fileExists(wranglerEntryPath()) {
		if out, err := runWranglerDirect(ctx, siteDir, "", nil, "whoami"); err == nil && strings.Contains(strings.ToLower(out), "logged in") {
			setAuthStatus("cloudflare", authDisplay(cloudflareAccountLabel(out)))
		} else {
			setAuthStatus("cloudflare", "Потрібна авторизація")
		}
	} else {
		setAuthStatus("cloudflare", "Потрібна авторизація")
	}

	coreDir := projectCoreDir(appRoot)
	if !dirExists(coreDir) {
		coreDir = dataRoot
	}
	if fileExists(vercelEntryPath()) {
		if out, err := runVercel(ctx, coreDir, "", nil, "whoami"); err == nil && !vercelAuthMissing(out) {
			user := strings.TrimSpace(lastUsefulLine(out))
			if user != "" {
				setAuthStatus("vercel", authDisplay(user))
			} else {
				setAuthStatus("vercel", "Потрібна авторизація")
			}
		} else {
			setAuthStatus("vercel", "Потрібна авторизація")
		}
	} else {
		setAuthStatus("vercel", "Потрібна авторизація")
	}

	if strings.TrimSpace(current.TursoPlatformToken) != "" {
		if org, _, err := tursoIdentityFromToken(ctx, current.TursoPlatformToken); err == nil {
			setAuthStatus("turso", authDisplay(org))
		} else {
			setAuthStatus("turso", "Потрібна авторизація")
		}
	} else {
		setAuthStatus("turso", "Потрібна авторизація")
	}
}

func interactiveAuthorizeService(service string) {
	authMu.Lock()
	if authRunning {
		authMu.Unlock()
		return
	}
	authRunning = true
	authMu.Unlock()
	defer func() { authMu.Lock(); authRunning = false; authMu.Unlock() }()
	runMu.Lock()
	busy := running
	runMu.Unlock()
	if busy {
		messageSync("Зупини поточне встановлення перед зміною акаунта.", "Авторизація", MB_OK|MB_ICONWARNING)
		return
	}
	label := map[string]string{"github": "GitHub", "cloudflare": "Cloudflare", "vercel": "Vercel", "turso": "Turso"}[service]
	if label == "" {
		return
	}
	setAuthStatus(service, "Авторизація...")
	setAuthCode(service, "")
	setStatus("Авторизація " + label + "...")
	appendLog(label + ": ручна браузерна авторизація запущена кнопкою користувача.")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	var err error
	switch service {
	case "github":
		err = ensurePortableGit(ctx)
		if err == nil {
			err = ensurePortableGitHubCLI(ctx)
		}
		if err == nil {
			gh := ghExePath()
			login, _, _ := githubIdentity(ctx, gh)
			if login != "" {
				_, _ = runDirect(ctx, dataRoot, "", nil, gh, "auth", "logout", "--hostname", "github.com", "--user", login)
			}
			resetServiceBinding("github")
			setAuthStatus("github", "Потрібна авторизація")
			_, err = runDirect(ctx, dataRoot, "", authorizationFlowHook("github"), gh, "auth", "login", "--web", "--hostname", "github.com", "--git-protocol", "https", "--insecure-storage")
			if err == nil {
				_, _ = runDirect(ctx, dataRoot, "", nil, gh, "auth", "setup-git", "--hostname", "github.com")
				err = ensureGitHubAccount(ctx, gh)
			}
		}
	case "cloudflare":
		err = ensurePortableNode(ctx)
		if err == nil {
			err = ensureWranglerCLI(ctx, dataRoot)
		}
		if err == nil {
			siteDir := filepath.Join(appRoot, "site")
			if !dirExists(siteDir) {
				siteDir = dataRoot
			}
			_, _ = runWranglerDirect(ctx, siteDir, "", nil, "logout")
			resetServiceBinding("cloudflare")
			setAuthStatus("cloudflare", "Потрібна авторизація")
			_, err = runWranglerDirect(ctx, siteDir, "", authorizationFlowHook("cloudflare"), "login", "--device")
			if err == nil {
				err = ensureCloudflareAccount(ctx, siteDir)
			}
		}
	case "vercel":
		coreDir := projectCoreDir(appRoot)
		if !dirExists(coreDir) {
			coreDir = dataRoot
		}
		err = ensureVercelCLI(ctx, coreDir)
		if err == nil {
			_, _ = runVercel(ctx, coreDir, "", nil, "logout")
			resetServiceBinding("vercel")
			setAuthStatus("vercel", "Потрібна авторизація")
			_, err = runVercel(ctx, coreDir, "", authorizationFlowHook("vercel"), "login")
			if err == nil {
				err = ensureVercelAccount(ctx, coreDir)
			}
		}
	case "turso":
		resetServiceBinding("turso")
		setAuthStatus("turso", "Потрібна авторизація")
		err = acquireTursoPlatformToken(ctx, false)
		if err == nil {
			err = ensureTursoAccount(ctx)
		}
	}
	if err != nil {
		appendLog(label + ": помилка ручної авторизації: " + err.Error())
		setAuthStatus(service, "Потрібна авторизація")
		setStatus("Помилка авторизації " + label)
		messageSync(label+": авторизація не завершена.\n\n"+err.Error(), label+" — авторизація", MB_OK|MB_ICONERROR)
		return
	}
	appendLog(label + ": браузерна авторизація завершена успішно.")
	setAuthCode(service, "")
	setStatus(label + ": авторизовано")
	go refreshAuthorizationPanel()
}

func stepCloudflare(ctx context.Context) error {
	siteDir := filepath.Join(appRoot, "site")
	if err := ensureCloudflareAccount(ctx, siteDir); err != nil {
		return err
	}
	return ensureCloudflareProjectNameAvailable(ctx, siteDir)
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
	if strings.TrimSpace(wslDistro) == "" {
		wslDistro = privateWSLDistroName()
	}
	args := []string{"-d", wslDistro, "--user", "root", "--", "bash", "-lc"}
	prefix := "export HOME=/root; export PATH=\"$HOME/.turso:$HOME/.local/bin:$PATH\"; "
	if strings.TrimSpace(current.TursoPlatformToken) != "" {
		prefix += "export TURSO_API_TOKEN=" + shQuote(current.TursoPlatformToken) + "; "
	}
	args = append(args, prefix+command)
	workDir := dataRoot
	if dirExists(appRoot) {
		workDir = appRoot
	}
	return runDirect(ctx, workDir, stdin, hook, "wsl.exe", args...)
}

func runWSLWithoutTursoToken(ctx context.Context, stdin string, hook func(string), command string) (string, error) {
	saved := current.TursoPlatformToken
	current.TursoPlatformToken = ""
	defer func() { current.TursoPlatformToken = saved }()
	return runWSL(ctx, stdin, hook, command)
}

func stepTursoAuth(ctx context.Context) error {
	appendLog("Turso: використовую Platform API напряму; WSL/Ubuntu/Turso CLI не потрібні.")
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
	createOut := ""
	if current.SiteURL == "" {
		createOut, err = runWrangler(ctx, siteDir, "", nil, "pages", "project", "create", current.CloudflareProject, "--production-branch", "main")
		if err != nil {
			return fmt.Errorf("створення Cloudflare Pages project %s: %w", current.CloudflareProject, err)
		}
	} else {
		appendLog("Cloudflare Pages project уже прив'язаний до локального state; пропускаю повторне create.")
	}
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
	expectedSiteURL := "https://" + current.ProjectName + ".pages.dev"
	if !strings.EqualFold(strings.TrimRight(current.SiteURL, "/"), expectedSiteURL) {
		assigned := current.SiteURL
		if createOut != "" {
			if u, parseErr := url.Parse(assigned); parseErr == nil {
				assignedProject := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".pages.dev")
				if assignedProject != "" {
					_, _ = runWrangler(ctx, siteDir, "", nil, "pages", "project", "delete", assignedProject, "--yes")
				}
			}
		}
		current.SiteURL = ""
		setFieldText(CTRL_SITE_URL, "")
		return fmt.Errorf("Cloudflare не видав точну адресу %s; отримано %s. Назва вже зайнята, вибери іншу", expectedSiteURL, assigned)
	}
	setFieldText(CTRL_SITE_URL, current.SiteURL)
	saveState()
	appendLog("Site URL: " + current.SiteURL)
	return nil
}

func stepTursoDB(ctx context.Context) error {
	current.TursoDB = current.ProjectName
	if strings.TrimSpace(current.TursoPlatformToken) == "" || strings.TrimSpace(current.TursoAccount) == "" {
		if err := ensureTursoAccount(ctx); err != nil {
			return err
		}
	}
	token := current.TursoPlatformToken
	org := current.TursoAccount
	group, err := tursoEnsureGroup(ctx, token, org)
	if err != nil {
		return fmt.Errorf("Turso group: %w", err)
	}
	base := "/v1/organizations/" + url.PathEscape(org) + "/databases"
	dbPath := base + "/" + url.PathEscape(current.TursoDB)
	appendLog("Перевіряю Turso database " + current.TursoDB + " через Platform API...")
	status, body, err := tursoPlatformRequest(ctx, token, http.MethodGet, dbPath, nil)
	if err != nil {
		return err
	}
	var dbResp struct {
		Database tursoDatabaseAPI `json:"database"`
	}
	if status == http.StatusNotFound {
		appendLog("Turso database не існує; створюю у group " + group + "...")
		status, body, err = tursoPlatformRequest(ctx, token, http.MethodPost, base, map[string]any{"name": current.TursoDB, "group": group})
		if err != nil {
			return err
		}
		if status != http.StatusOK {
			return tursoAPIError(status, body)
		}
		if err := json.Unmarshal(body, &dbResp); err != nil {
			return fmt.Errorf("Turso create database JSON: %w", err)
		}
	} else if status == http.StatusOK {
		if err := json.Unmarshal(body, &dbResp); err != nil {
			return fmt.Errorf("Turso database JSON: %w", err)
		}
	} else {
		return tursoAPIError(status, body)
	}
	if strings.TrimSpace(dbResp.Database.Hostname) == "" {
		return errors.New("Turso API не повернув database hostname")
	}
	current.TursoURL = "libsql://" + strings.TrimSpace(dbResp.Database.Hostname)
	setFieldText(CTRL_TURSO_URL, current.TursoURL)
	appendLog("TURSO_DATABASE_URL: " + current.TursoURL)

	if current.TursoToken == "" {
		status, body, err = tursoPlatformRequest(ctx, token, http.MethodPost, dbPath+"/auth/tokens?expiration=never&authorization=full-access", nil)
		if err != nil {
			return err
		}
		if status != http.StatusOK {
			return tursoAPIError(status, body)
		}
		var tok struct {
			JWT string `json:"jwt"`
		}
		if err := json.Unmarshal(body, &tok); err != nil {
			return fmt.Errorf("Turso database token JSON: %w", err)
		}
		current.TursoToken = strings.TrimSpace(tok.JWT)
		if current.TursoToken == "" {
			return errors.New("Turso Platform API не повернув database auth token")
		}
	}
	setFieldText(CTRL_TURSO_TOKEN, current.TursoToken)
	if current.CoreKey == "" {
		current.CoreKey = randomHex(32)
	}
	setFieldText(CTRL_CORE_KEY, current.CoreKey)
	saveState()
	appendLog("TURSO_AUTH_TOKEN: створено через Platform API і збережено через DPAPI (у лог token не друкується).")
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
	if err := ensureYoruWSL(ctx); err != nil {
		return "", err
	}
	wslDistro = privateWSLDistroName()
	return privateWSLDistroName(), nil
}

func ensureDataLayout() error {
	for _, rel := range []string{"tools", "downloads", "cache/npm", "auth/github", "auth/cloudflare", "auth/vercel", "auth/git", "auth/home", "auth/turso", "project", "state", "logs"} {
		if err := os.MkdirAll(filepath.Join(dataRoot, filepath.FromSlash(rel)), 0755); err != nil {
			return err
		}
	}
	return nil
}

func configureIsolatedEnvironment() {
	_ = os.Setenv("GH_CONFIG_DIR", filepath.Join(dataRoot, "auth", "github"))
	_ = os.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(dataRoot, "auth", "git", ".gitconfig"))
	_ = os.Setenv("HOME", filepath.Join(dataRoot, "auth", "home"))
	_ = os.Setenv("XDG_CONFIG_HOME", filepath.Join(dataRoot, "auth", "cloudflare"))
	_ = os.Setenv("XDG_CACHE_HOME", filepath.Join(dataRoot, "cache", "xdg"))
	_ = os.Setenv("npm_config_cache", filepath.Join(dataRoot, "cache", "npm"))
	for _, k := range []string{"GH_TOKEN", "GITHUB_TOKEN", "VERCEL_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL"} {
		_ = os.Unsetenv(k)
	}
	addCommonToolPaths()
}

func dirExists(path string) bool  { st, err := os.Stat(path); return err == nil && st.IsDir() }
func fileExists(path string) bool { st, err := os.Stat(path); return err == nil && !st.IsDir() }
func portableNodeRoot() string    { return filepath.Join(dataRoot, "tools", "node") }
func nodeExePath() string         { return filepath.Join(portableNodeRoot(), "node.exe") }
func portableGitRoot() string     { return filepath.Join(dataRoot, "tools", "git") }
func gitExePath() string          { return filepath.Join(portableGitRoot(), "cmd", "git.exe") }
func portableGHRoot() string      { return filepath.Join(dataRoot, "tools", "gh") }
func ghExePath() string {
	p := filepath.Join(portableGHRoot(), "bin", "gh.exe")
	if fileExists(p) {
		return p
	}
	return filepath.Join(portableGHRoot(), "gh.exe")
}
func wranglerToolRoot() string { return filepath.Join(dataRoot, "tools", "wrangler") }
func wranglerEntryPath() string {
	return filepath.Join(wranglerToolRoot(), "node_modules", "wrangler", "bin", "wrangler.js")
}
func vercelGlobalConfigDir() string { return filepath.Join(dataRoot, "auth", "vercel") }

func downloadFile(ctx context.Context, rawURL, dst, label string) error {
	if fileExists(dst) {
		return nil
	}
	_ = os.MkdirAll(filepath.Dir(dst), 0755)
	tmp := dst + ".part"
	_ = os.Remove(tmp)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "YORU-Installer/"+appVersion)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("завантаження %s: %w", label, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("завантаження %s: HTTP %d", label, resp.StatusCode)
	}
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	defer f.Close()
	buf := make([]byte, 1024*1024)
	var done int64
	total := resp.ContentLength
	lastPct := -10
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				return werr
			}
			done += int64(n)
			if total > 0 {
				pct := int(done * 100 / total)
				if pct >= lastPct+10 {
					lastPct = pct
					setStatus(fmt.Sprintf("%s: %d%%", label, pct))
					appendLog(fmt.Sprintf("%s: %d%%", label, pct))
				}
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return rerr
		}
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp, dst); err != nil {
		return err
	}
	appendLog(label + ": завантажено у data\\downloads")
	return nil
}

func extractZipTo(zipPath, dest string, stripFirst bool) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()
	_ = os.RemoveAll(dest)
	if err = os.MkdirAll(dest, 0755); err != nil {
		return err
	}
	for _, f := range r.File {
		name := filepath.Clean(filepath.FromSlash(f.Name))
		if stripFirst {
			parts := strings.Split(name, string(os.PathSeparator))
			if len(parts) < 2 {
				continue
			}
			name = filepath.Join(parts[1:]...)
		}
		if name == "." || name == "" {
			continue
		}
		target := filepath.Join(dest, name)
		cleanDest := filepath.Clean(dest) + string(os.PathSeparator)
		cleanTarget := filepath.Clean(target)
		if !strings.HasPrefix(strings.ToLower(cleanTarget), strings.ToLower(cleanDest)) {
			return errors.New("unsafe zip path")
		}
		if f.FileInfo().IsDir() {
			_ = os.MkdirAll(target, 0755)
			continue
		}
		_ = os.MkdirAll(filepath.Dir(target), 0755)
		rc, e := f.Open()
		if e != nil {
			return e
		}
		out, e := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, f.Mode())
		if e != nil {
			rc.Close()
			return e
		}
		_, e = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if e != nil {
			return e
		}
	}
	return nil
}

func ensurePortableNode(ctx context.Context) error {
	if fileExists(nodeExePath()) {
		if out, err := runCaptureDecoded(ctx, dataRoot, nodeExePath(), "--version"); err == nil && strings.TrimSpace(out) != "" {
			addCommonToolPaths()
			return nil
		}
	}
	url := "https://nodejs.org/download/release/v" + nodeVersion + "/node-v" + nodeVersion + "-win-x64.zip"
	zipPath := filepath.Join(dataRoot, "downloads", "node-v"+nodeVersion+"-win-x64.zip")
	appendLog("Готую portable Node.js " + nodeVersion + " у data\\tools\\node...")
	if err := downloadFile(ctx, url, zipPath, "Node.js"); err != nil {
		return err
	}
	if err := extractZipTo(zipPath, portableNodeRoot(), true); err != nil {
		return fmt.Errorf("розпакування Node.js: %w", err)
	}
	addCommonToolPaths()
	return nil
}

func ensurePortableGit(ctx context.Context) error {
	if fileExists(gitExePath()) {
		return nil
	}
	zipPath := filepath.Join(dataRoot, "downloads", "MinGit-"+gitVersion+"-64-bit.zip")
	url := "https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.5/MinGit-" + gitVersion + "-64-bit.zip"
	appendLog("Готую portable Git у data\\tools\\git...")
	if err := downloadFile(ctx, url, zipPath, "Git"); err != nil {
		return err
	}
	if err := extractZipTo(zipPath, portableGitRoot(), false); err != nil {
		return fmt.Errorf("розпакування Git: %w", err)
	}
	addCommonToolPaths()
	if !fileExists(gitExePath()) {
		return errors.New("portable Git розпаковано, але cmd\\git.exe не знайдено")
	}
	return nil
}

func ensurePortableGitHubCLI(ctx context.Context) error {
	if fileExists(ghExePath()) {
		return nil
	}
	zipPath := filepath.Join(dataRoot, "downloads", "gh_"+githubCLIVersion+"_windows_amd64.zip")
	url := "https://github.com/cli/cli/releases/download/v" + githubCLIVersion + "/gh_" + githubCLIVersion + "_windows_amd64.zip"
	appendLog("Готую GitHub CLI у data\\tools\\gh...")
	if err := downloadFile(ctx, url, zipPath, "GitHub CLI"); err != nil {
		return err
	}
	if err := extractZipTo(zipPath, portableGHRoot(), true); err != nil {
		return fmt.Errorf("розпакування GitHub CLI: %w", err)
	}
	addCommonToolPaths()
	if !fileExists(ghExePath()) {
		return errors.New("GitHub CLI розпаковано, але gh.exe не знайдено")
	}
	return nil
}

func runWranglerDirect(ctx context.Context, dir, stdin string, hook func(string), args ...string) (string, error) {
	entry := wranglerEntryPath()
	if !fileExists(entry) {
		return "", fmt.Errorf("Wrangler entrypoint не знайдено: %s", entry)
	}
	all := append([]string{entry}, args...)
	appendLog("> node " + redactCommand(joinArgsForLog(all...)))
	return runDirect(ctx, dir, stdin, hook, nodeExePath(), all...)
}
func ensureWranglerCLI(ctx context.Context, dir string) error {
	if err := ensurePortableNode(ctx); err != nil {
		return err
	}
	entry := wranglerEntryPath()
	if fileExists(entry) {
		if _, err := runWranglerDirect(ctx, dir, "", nil, "--version"); err == nil {
			return nil
		}
		_ = os.RemoveAll(wranglerToolRoot())
	}
	_ = os.MkdirAll(wranglerToolRoot(), 0755)
	appendLog("Встановлюю Wrangler " + wranglerVersion + " у data\\tools\\wrangler...")
	if err := installNPMDirect(ctx, wranglerToolRoot(), "wrangler@"+wranglerVersion); err != nil {
		return err
	}
	if !fileExists(entry) {
		return fmt.Errorf("Wrangler entrypoint не знайдено після install: %s", entry)
	}
	return nil
}

func privateWSLDistroName() string {
	h := sha256.Sum256([]byte(strings.ToLower(filepath.Clean(dataRoot))))
	return fmt.Sprintf("%s-%x", yoruWSLDistroPrefix, h[:4])
}

func yoruWSLInstallDir() string { return filepath.Join(dataRoot, "wsl", "ubuntu") }
func yoruWSLRootfsPath() string {
	return filepath.Join(dataRoot, "downloads", "ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz")
}
func system32Exe(name string) string {
	root := strings.TrimSpace(os.Getenv("SystemRoot"))
	if root == "" {
		root = `C:\Windows`
	}
	// Prefer an explicit Windows system path. Portable YORU tools intentionally
	// modify PATH, so Windows platform binaries must never depend on PATH lookup.
	candidate := filepath.Join(root, "System32", name)
	if fileExists(candidate) {
		return candidate
	}
	// Sysnative is useful if a future 32-bit build ever calls this code on x64.
	sysnative := filepath.Join(root, "Sysnative", name)
	if fileExists(sysnative) {
		return sysnative
	}
	return candidate
}

func wslExePath() string { return system32Exe("wsl.exe") }
func powershellExePath() string {
	root := strings.TrimSpace(os.Getenv("SystemRoot"))
	if root == "" {
		root = `C:\Windows`
	}
	p := filepath.Join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	if fileExists(p) {
		return p
	}
	return "powershell.exe"
}
func msiexecExePath() string { return system32Exe("msiexec.exe") }

func probeWSL(ctx context.Context) (string, error) {
	// `wsl --status` is NOT a readiness check here.  On several Windows builds it
	// returns a non-zero code even though WSL1 is fully usable.  Listing distros is
	// the smallest command that proves the Windows WSL subsystem can actually run.
	return runCaptureDecoded(ctx, dataRoot, wslExePath(), "-l", "-q")
}

func yoruWSLReady(ctx context.Context) bool {
	out, err := probeWSL(ctx)
	if err != nil {
		return false
	}
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r", ""), "\n") {
		if strings.EqualFold(strings.TrimSpace(strings.TrimPrefix(line, "*")), privateWSLDistroName()) {
			return true
		}
	}
	return false
}

func encodePowerShellCommand(script string) string {
	u := utf16.Encode([]rune(script))
	b := make([]byte, len(u)*2)
	for i, v := range u {
		b[i*2] = byte(v)
		b[i*2+1] = byte(v >> 8)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func enableWindowsFeaturesElevated(ctx context.Context, features []string, reason string) (bool, error) {
	if len(features) == 0 {
		return false, nil
	}
	_ = os.MkdirAll(filepath.Join(dataRoot, "cache"), 0755)
	resultPath := filepath.Join(dataRoot, "cache", "yoru-enable-windows-features.result")
	_ = os.Remove(resultPath)

	var quoted []string
	for _, f := range features {
		f = strings.TrimSpace(f)
		if f != "" {
			quoted = append(quoted, "'"+strings.ReplaceAll(f, "'", "''")+"'")
		}
	}
	if len(quoted) == 0 {
		return false, nil
	}

	// Do not pass a .ps1 path through Start-Process -Verb RunAs.  That proved
	// fragile on Windows when YORU lives under a non-ASCII path.  Instead the
	// elevated PowerShell receives an ASCII -EncodedCommand and invokes DISM
	// directly.  The elevated child writes a small result file back into data.
	resultPS := strings.ReplaceAll(resultPath, "'", "''")
	childScript := "$ErrorActionPreference='Stop'\r\n" +
		"$restart=$false\r\n" +
		"$details=@()\r\n" +
		"$dism=Join-Path $env:WINDIR 'System32\\dism.exe'\r\n" +
		"try {\r\n" +
		"  foreach($name in @(" + strings.Join(quoted, ",") + ")) {\r\n" +
		"    & $dism '/Online' '/Enable-Feature' ('/FeatureName:'+$name) '/All' '/NoRestart' | Out-Null\r\n" +
		"    $code=$LASTEXITCODE\r\n" +
		"    $details += ($name+'='+$code)\r\n" +
		"    if($code -eq 3010) { $restart=$true }\r\n" +
		"    elseif($code -ne 0) { throw ('DISM '+$name+' exit code '+$code) }\r\n" +
		"  }\r\n" +
		"  [System.IO.File]::WriteAllText('" + resultPS + "', ('OK|'+$restart+'|'+($details -join ',')), (New-Object System.Text.UTF8Encoding($false)))\r\n" +
		"  exit 0\r\n" +
		"} catch {\r\n" +
		"  [System.IO.File]::WriteAllText('" + resultPS + "', ('ERROR|'+$_.Exception.Message), (New-Object System.Text.UTF8Encoding($false)))\r\n" +
		"  exit 1\r\n" +
		"}\r\n"
	encoded := encodePowerShellCommand(childScript)

	messageSync(reason+"\n\nWindows зараз покаже UAC. Installer запустить DISM напряму з підвищеними правами. Ubuntu і всі Linux-дані залишаться у data.", "Підготовка WSL", MB_OK|MB_ICONINFORMATION)
	launch := "$ErrorActionPreference='Stop'; try { " +
		"$p=Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','" + encoded + "') -Verb RunAs -Wait -PassThru; " +
		"Write-Output ('YORU_ELEVATED_EXIT='+$p.ExitCode); exit 0 " +
		"} catch { Write-Output ('YORU_UAC_ERROR='+$_.Exception.Message); exit 0 }"
	out, launchErr := runCaptureDecoded(ctx, dataRoot, powershellExePath(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", launch)
	cleanOut := strings.TrimSpace(out)
	if cleanOut != "" {
		appendLog("Windows UAC/DISM: " + cleanOut)
	}
	if strings.Contains(cleanOut, "YORU_UAC_ERROR=") {
		return false, errors.New(strings.TrimSpace(strings.SplitN(cleanOut, "YORU_UAC_ERROR=", 2)[1]))
	}

	resultBytes, readErr := os.ReadFile(resultPath)
	result := strings.TrimSpace(string(resultBytes))
	if result != "" {
		appendLog("Windows feature result: " + result)
	}
	if strings.HasPrefix(result, "ERROR|") {
		return false, errors.New(strings.TrimPrefix(result, "ERROR|"))
	}
	if readErr != nil || result == "" {
		if launchErr != nil {
			return false, fmt.Errorf("UAC/PowerShell launch: %w; output: %s", launchErr, cleanOut)
		}
		return false, errors.New("elevated DISM завершився без result-файлу; UAC міг бути скасований або Windows заблокував elevated process")
	}
	if !strings.HasPrefix(result, "OK|") {
		return false, fmt.Errorf("невідомий результат elevated DISM: %s", result)
	}

	parts := strings.Split(result, "|")
	restartNeeded := len(parts) >= 2 && strings.EqualFold(strings.TrimSpace(parts[1]), "True")
	if len(parts) >= 3 && strings.TrimSpace(parts[2]) != "" {
		appendLog("DISM exit codes: " + strings.TrimSpace(parts[2]))
	}
	return restartNeeded, nil
}

type wslReleaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}
type wslReleaseInfo struct {
	TagName string            `json:"tag_name"`
	Assets  []wslReleaseAsset `json:"assets"`
}

func latestWSLMSI(ctx context.Context) (string, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wslLatestReleaseAPI, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "YORU-Installer/"+appVersion)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", "", fmt.Errorf("GitHub WSL release API HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	var rel wslReleaseInfo
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return "", "", err
	}
	for _, a := range rel.Assets {
		low := strings.ToLower(strings.TrimSpace(a.Name))
		if strings.HasSuffix(low, ".x64.msi") && strings.TrimSpace(a.URL) != "" {
			return a.Name, a.URL, nil
		}
	}
	return "", "", fmt.Errorf("у stable WSL release %s не знайдено x64 MSI", rel.TagName)
}

func installModernWSLPackage(ctx context.Context) (bool, error) {
	name, downloadURL, err := latestWSLMSI(ctx)
	if err != nil {
		return false, fmt.Errorf("пошук Microsoft WSL MSI: %w", err)
	}
	msiPath := filepath.Join(dataRoot, "downloads", name)
	appendLog("WSL runtime відсутній/пошкоджений. Завантажую офіційний Microsoft WSL MSI у data\\downloads: " + name)
	setStatus("WSL runtime: завантаження Microsoft MSI...")
	if err := downloadFile(ctx, downloadURL, msiPath, "Microsoft WSL MSI"); err != nil {
		return false, fmt.Errorf("завантаження Microsoft WSL MSI: %w", err)
	}

	resultPath := filepath.Join(dataRoot, "cache", "yoru-install-wsl-msi.result")
	_ = os.MkdirAll(filepath.Dir(resultPath), 0755)
	_ = os.Remove(resultPath)
	msiPS := strings.ReplaceAll(msiPath, "'", "''")
	resultPS := strings.ReplaceAll(resultPath, "'", "''")
	childScript := "$ErrorActionPreference='Stop'\r\n" +
		"$msi=Join-Path $env:WINDIR 'System32\\msiexec.exe'\r\n" +
		"try {\r\n" +
		"  & $msi '/i' '" + msiPS + "' '/qn' '/norestart' | Out-Null\r\n" +
		"  $code=$LASTEXITCODE\r\n" +
		"  [System.IO.File]::WriteAllText('" + resultPS + "', ('MSI|'+$code), (New-Object System.Text.UTF8Encoding($false)))\r\n" +
		"  if($code -eq 0 -or $code -eq 3010 -or $code -eq 1641) { exit 0 }\r\n" +
		"  exit 1\r\n" +
		"} catch {\r\n" +
		"  [System.IO.File]::WriteAllText('" + resultPS + "', ('ERROR|'+$_.Exception.Message), (New-Object System.Text.UTF8Encoding($false)))\r\n" +
		"  exit 1\r\n" +
		"}\r\n"
	encoded := encodePowerShellCommand(childScript)
	messageSync("Компонент WSL увімкнений, але сам WSL runtime Windows не запускається.\n\nInstaller завантажив офіційний Microsoft WSL MSI у data\\downloads. Зараз Windows покаже UAC для його встановлення.", "Відновлення WSL", MB_OK|MB_ICONINFORMATION)
	launch := "$ErrorActionPreference='Stop'; try { " +
		"$p=Start-Process -FilePath '" + strings.ReplaceAll(powershellExePath(), "'", "''") + "' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','" + encoded + "') -Verb RunAs -Wait -PassThru; " +
		"Write-Output ('YORU_WSL_MSI_ELEVATED_EXIT='+$p.ExitCode); exit 0 " +
		"} catch { Write-Output ('YORU_WSL_MSI_UAC_ERROR='+$_.Exception.Message); exit 0 }"
	out, launchErr := runCaptureDecoded(ctx, dataRoot, powershellExePath(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", launch)
	cleanOut := strings.TrimSpace(out)
	if cleanOut != "" {
		appendLog("WSL MSI UAC: " + cleanOut)
	}
	if strings.Contains(cleanOut, "YORU_WSL_MSI_UAC_ERROR=") {
		return false, errors.New(strings.TrimSpace(strings.SplitN(cleanOut, "YORU_WSL_MSI_UAC_ERROR=", 2)[1]))
	}
	b, readErr := os.ReadFile(resultPath)
	result := strings.TrimSpace(string(b))
	if result != "" {
		appendLog("WSL MSI result: " + result)
	}
	if strings.HasPrefix(result, "ERROR|") {
		return false, errors.New(strings.TrimPrefix(result, "ERROR|"))
	}
	if readErr != nil || !strings.HasPrefix(result, "MSI|") {
		if launchErr != nil {
			return false, fmt.Errorf("WSL MSI UAC launch: %w; output: %s", launchErr, cleanOut)
		}
		return false, errors.New("WSL MSI installer не залишив result-файл")
	}
	code, _ := strconv.Atoi(strings.TrimSpace(strings.TrimPrefix(result, "MSI|")))
	if code != 0 && code != 3010 && code != 1641 {
		return false, fmt.Errorf("Microsoft WSL MSI exit code %d", code)
	}
	return code == 3010 || code == 1641, nil
}

func wslPathMissing(out string) bool {
	low := strings.ToLower(strings.TrimSpace(out))
	return strings.Contains(low, "system cannot find the path specified") ||
		strings.Contains(low, "системе не удается найти указанный путь") ||
		strings.Contains(low, "система не может найти указанный путь")
}

func ensureWSLPlatform(ctx context.Context) error {
	firstOut, firstErr := probeWSL(ctx)
	if firstErr == nil {
		appendLog("Windows WSL subsystem/runtime: OK (wsl -l -q).")
		return nil
	}
	if strings.TrimSpace(firstOut) != "" {
		appendLog("Initial WSL probe: " + strings.TrimSpace(firstOut))
	}

	restartFeature, err := enableWindowsFeaturesElevated(ctx,
		[]string{"Microsoft-Windows-Subsystem-Linux"},
		"Для приватного Ubuntu YORU потрібен компонент Windows Subsystem for Linux. VirtualMachinePlatform для основного режиму НЕ потрібен — Turso запускатиметься через WSL1.")
	if err != nil {
		return err
	}

	probeOut, probeErr := probeWSL(ctx)
	if probeErr == nil {
		appendLog("Windows WSL subsystem готовий після ввімкнення feature.")
		return nil
	}
	if strings.TrimSpace(probeOut) != "" {
		appendLog("WSL probe після feature: " + strings.TrimSpace(probeOut))
	}

	// A successful DISM result only enables the inbox Windows component. On
	// current Windows builds the actual WSL runtime is serviced separately via
	// the Microsoft Store/MSI package. If wsl.exe exists but fails internally
	// with ERROR_PATH_NOT_FOUND, repair/install the official stable MSI.
	if wslPathMissing(firstOut) || wslPathMissing(probeOut) || !restartFeature {
		restartMSI, msiErr := installModernWSLPackage(ctx)
		if msiErr != nil {
			if restartFeature {
				return fmt.Errorf("WSL feature очікує reboot; додатково не вдалося встановити WSL runtime: %w", msiErr)
			}
			return fmt.Errorf("відновлення Microsoft WSL runtime: %w", msiErr)
		}
		time.Sleep(2 * time.Second)
		probeOut2, probeErr2 := probeWSL(ctx)
		if strings.TrimSpace(probeOut2) != "" {
			appendLog("WSL probe після Microsoft MSI: " + strings.TrimSpace(probeOut2))
		}
		if probeErr2 == nil {
			appendLog("Microsoft WSL runtime: OK після MSI repair/install.")
			return nil
		}
		if restartFeature || restartMSI {
			return errors.New("WSL feature/runtime встановлено успішно, але Windows просить завершити оновлення перезапуском. Перезапусти Windows один раз і натисни Turso знову.")
		}
		return fmt.Errorf("Microsoft WSL MSI встановлено, але `wsl -l -q` досі не запускається: %s", strings.TrimSpace(probeOut2))
	}
	if restartFeature {
		return errors.New("DISM увімкнув Windows Subsystem for Linux і повернув код 3010: потрібен один перезапуск Windows. Після перезапуску натисни Turso ще раз.")
	}
	return fmt.Errorf("WSL не запускається після ввімкнення feature: %s", strings.TrimSpace(probeOut))
}
func gunzipFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	gz, err := gzip.NewReader(in)
	if err != nil {
		return err
	}
	defer gz.Close()
	_ = os.MkdirAll(filepath.Dir(dst), 0755)
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, gz)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	_ = os.Remove(dst)
	return os.Rename(tmp, dst)
}

func ensureYoruWSL(ctx context.Context) error {
	if yoruWSLReady(ctx) {
		wslDistro = privateWSLDistroName()
		return nil
	}
	if err := ensureWSLPlatform(ctx); err != nil {
		return err
	}
	rootfsGz := yoruWSLRootfsPath()
	rootfsTar := filepath.Join(dataRoot, "downloads", "ubuntu-noble-wsl-amd64-wsl.rootfs.tar")
	appendLog("Готую приватний Ubuntu 24.04 для YORU у data\\wsl\\ubuntu (приблизно 340 MB download)...")
	if err := downloadFile(ctx, ubuntuRootfsURL, rootfsGz, "Ubuntu WSL"); err != nil {
		return err
	}
	if !fileExists(rootfsTar) {
		setStatus("Ubuntu WSL: розпаковування rootfs...")
		appendLog("Розпаковую Ubuntu rootfs tar у data\\downloads...")
		if err := gunzipFile(rootfsGz, rootfsTar); err != nil {
			return fmt.Errorf("розпаковування Ubuntu rootfs: %w", err)
		}
	}

	// WSL1 is deliberately the primary mode.  Turso CLI does not need a VM,
	// systemd or WSL2.  This keeps the entire Ubuntu filesystem in data and avoids
	// forcing VirtualMachinePlatform/BIOS virtualization on users that only want
	// to deploy YORU.
	_ = os.RemoveAll(yoruWSLInstallDir())
	_ = os.MkdirAll(yoruWSLInstallDir(), 0755)
	appendLog("Імпортую " + privateWSLDistroName() + " у data\\wsl\\ubuntu як WSL1 (portable mode)...")
	out, err := runCaptureDecoded(ctx, dataRoot, wslExePath(), "--import", privateWSLDistroName(), yoruWSLInstallDir(), rootfsTar, "--version", "1")
	if strings.TrimSpace(out) != "" {
		appendLog(strings.TrimSpace(out))
	}

	if err != nil {
		appendLog("WSL1 import не вдався. Готую VirtualMachinePlatform і спробую WSL2 як fallback...")
		restartNeeded2, featureErr := enableWindowsFeaturesElevated(ctx,
			[]string{"Microsoft-Windows-Subsystem-Linux", "VirtualMachinePlatform"},
			"WSL1 import не спрацював. Installer спробує WSL2 fallback, для якого потрібен VirtualMachinePlatform.")
		if featureErr != nil {
			return fmt.Errorf("WSL1 import: %v; підготовка WSL2: %w", err, featureErr)
		}
		if restartNeeded2 {
			return errors.New("Для WSL2 fallback DISM повернув код 3010. Потрібен один перезапуск Windows; після нього натисни Turso ще раз. WSL1 залишатиметься пріоритетним режимом.")
		}
		_ = os.RemoveAll(yoruWSLInstallDir())
		_ = os.MkdirAll(yoruWSLInstallDir(), 0755)
		out, err = runCaptureDecoded(ctx, dataRoot, wslExePath(), "--import", privateWSLDistroName(), yoruWSLInstallDir(), rootfsTar, "--version", "2")
		if strings.TrimSpace(out) != "" {
			appendLog(strings.TrimSpace(out))
		}
	}
	if err != nil {
		return fmt.Errorf("імпорт Ubuntu у data не вдався ні через WSL1, ні через WSL2: %w", err)
	}
	wslDistro = privateWSLDistroName()
	if _, err = runWSL(ctx, "", nil, "printf YORU-WSL-OK"); err != nil {
		return fmt.Errorf("перший запуск YORU Ubuntu: %w", err)
	}
	appendLog("Ubuntu готовий: data\\wsl\\ubuntu. Основний режим WSL1; системні Ubuntu-дистрибутиви користувача не використовуються.")
	return nil
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
	candidates := []string{filepath.Join(portableNodeRoot(), "node_modules", "npm", "bin", "npm-cli.js"), filepath.Join(portableNodeRoot(), "node_modules", "npm", "bin", "npm-cli.cjs")}
	for _, c := range candidates {
		if fileExists(c) {
			return c, nil
		}
	}
	return "", fmt.Errorf("npm-cli.js не знайдено у portable Node.js: %s", portableNodeRoot())
}

func npxCLIPath() (string, error) {
	candidates := []string{filepath.Join(portableNodeRoot(), "node_modules", "npm", "bin", "npx-cli.js"), filepath.Join(portableNodeRoot(), "node_modules", "npm", "bin", "npx-cli.cjs")}
	for _, c := range candidates {
		if fileExists(c) {
			return c, nil
		}
	}
	return "", fmt.Errorf("npx-cli.js не знайдено у portable Node.js: %s", portableNodeRoot())
}

func runNpxPackage(ctx context.Context, dir, stdin string, hook func(string), pkg string, args ...string) (string, error) {
	if err := ensurePortableNode(ctx); err != nil {
		return "", err
	}
	npxCLI, err := npxCLIPath()
	if err != nil {
		return "", err
	}
	all := []string{npxCLI, "--yes", pkg}
	all = append(all, args...)
	appendLog("> node " + redactCommand(joinArgsForLog(all...)))
	return runDirect(ctx, dir, stdin, hook, nodeExePath(), all...)
}

func runWrangler(ctx context.Context, dir, stdin string, hook func(string), args ...string) (string, error) {
	if err := ensureWranglerCLI(ctx, dir); err != nil {
		return "", err
	}
	return runWranglerDirect(ctx, dir, stdin, hook, args...)
}

func installNPMDirect(ctx context.Context, dir string, pkg string) error {
	if err := ensurePortableNode(ctx); err != nil {
		return err
	}
	npmCLI, err := npmCLIPath()
	if err != nil {
		return err
	}
	args := []string{npmCLI, "install", "--no-audit", "--no-fund", pkg}
	appendLog("> node " + redactCommand(joinArgsForLog(args...)))
	_, err = runDirect(ctx, dir, "", nil, nodeExePath(), args...)
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

func extractAuthorizationCode(line string) string {
	clean := strings.TrimSpace(line)
	low := strings.ToLower(clean)
	if !strings.Contains(low, "code") && !strings.Contains(low, "код") {
		return ""
	}
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`(?i)(?:one[- ]time|device|verification|authorization|auth)?\s*code(?:\s+is)?\s*[:=]?\s*([A-Z0-9]{4,12}(?:-[A-Z0-9]{4,12}){0,2})`),
		regexp.MustCompile(`(?i)код(?:\s+авторизац(?:ії|ии))?\s*[:=]?\s*([A-Z0-9]{4,12}(?:-[A-Z0-9]{4,12}){0,2})`),
	}
	for _, re := range patterns {
		if m := re.FindStringSubmatch(clean); len(m) == 2 {
			code := strings.ToUpper(strings.TrimSpace(m[1]))
			if len(code) >= 4 {
				return code
			}
		}
	}
	fallback := regexp.MustCompile(`\b[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8}){1,2}\b`)
	if code := fallback.FindString(strings.ToUpper(clean)); code != "" {
		return code
	}
	return ""
}

func authorizationFlowHook(service string) func(string) {
	openHook := openFirstURLHook()
	return func(line string) {
		openHook(line)
		if code := extractAuthorizationCode(line); code != "" {
			setAuthCode(service, code)
			appendLog(strings.ToUpper(service) + " — КОД АВТОРИЗАЦІЇ: " + code)
		}
	}
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
