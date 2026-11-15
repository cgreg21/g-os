version = 1
interval = 5 * 60

source(
    "weather",
    url="https://api.open-meteo.com/v1/forecast?latitude=48.85&longitude=2.35&current=temperature_2m",
    refresh=interval,
    timeout=10,
)