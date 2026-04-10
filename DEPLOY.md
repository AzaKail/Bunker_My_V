# Деплой на Render

## Быстрый старт

1. Залей проект на GitHub (репозиторий может быть приватным)
2. Зайди на https://render.com → New → Web Service
3. Подключи GitHub репозиторий с проектом
4. Настройки заполнятся автоматически из `render.yaml`, но проверь:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Environment:** Python 3
5. Нажми **Deploy** — через ~2 минуты игра доступна по HTTPS

## WebSocket на Render

Render **поддерживает WebSocket из коробки** — ничего дополнительно настраивать не нужно.
`wss://` будет работать автоматически, так как в коде:
```js
const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
```

## Важно: данные не сохраняются между перезапусками

Сейчас аккаунты и комнаты хранятся в памяти (`dict` в Python).
При каждом деплое или рестарте сервера они сбрасываются.
В будущем — подключить Firebase или PostgreSQL (Render даёт бесплатную БД).

## Бесплатный план Render

- Сервис засыпает после 15 минут неактивности
- Первый запрос после сна занимает ~30 сек (холодный старт)
- Для постоянной игры — подключить UptimeRobot (бесплатный пинг каждые 5 мин)

## Локальный запуск

```bash
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
# открыть http://localhost:8000
```
