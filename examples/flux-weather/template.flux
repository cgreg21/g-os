version: 1
desktop:
  - type: row
    children:
      - type: icon
        name: weather-clear-symbolic
      - type: text
        style: title
        text: "{{data.weather.current.temperature_2m}} °C"
  - type: text
    style: secondary
    text: "Etat : {{status.weather}} {{error.weather}}"
  - type: button
    name: view-refresh-symbolic
    text: Actualiser
    source: weather
dock:
  - type: text
    text: "{{data.weather.current.temperature_2m}} °C"
square:
  - type: text
    text: "{{data.weather.current.temperature_2m}}°"