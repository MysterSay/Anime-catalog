# 1. Переходимо в директорію проекту
Set-Location "C:\Users\sanya\Desktop\anime\Anime-catalog"

# 2. Запитуємо номер версії в консолі
$version = Read-Host "Введіть номер версії (наприклад, 4.6 або 4.6.1)"

# Якщо користувач нічого не ввів — виходимо, щоб не зробити порожній коміт
if ([string]::IsNullOrWhiteSpace($version)) {
    Write-Host "❌ Версію не вказано. Операцію скасовано." -ForegroundColor Red
    exit
}

# 3. Виконуємо Git команди
Write-Host "📌 Додаємо зміни..." -ForegroundColor Yellow
git add .

$commitMessage = "Exclude worker from Sonar scan web v$version"
Write-Host "💬 Створюємо коміт: '$commitMessage'" -ForegroundColor Cyan
git commit -m $commitMessage

Write-Host "🚀 Відправляємо зміни на GitHub..." -ForegroundColor Green
git push origin main

Write-Host "✅ Синхронізацію успішно завершено!" -ForegroundColor BrightGreen