#include <DHTesp.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <esp_arduino_version.h>
#include <math.h>

#define HOME_TOPIC "nhathongminh/esp32-ec2d91386fb37524"
constexpr char MQTT_HOST[] = "broker.hivemq.com";
constexpr int MQTT_PORT = 1883;
constexpr char STATE_TOPIC[] = HOME_TOPIC "/state";
constexpr char COMMAND_PATTERN[] = HOME_TOPIC "/cmd/+";
constexpr int DHT_PIN = 25, LDR_PIN = 34, PIR_PIN = 27;
constexpr int ARM_PIN = 26, DOOR_BUTTON_PIN = 23;
constexpr int SERVO_PIN = 18, LAMP_PIN = 19, FAN_PIN = 21, BUZZER_PIN = 22;
constexpr int SERVO_CHANNEL = 0, BUZZER_CHANNEL = 2;
constexpr unsigned long DOOR_OPEN_MS = 5000;

DHTesp dht;
WiFiClient network;
PubSubClient mqtt(network);
enum class Mode { Auto, On, Off };
Mode lampMode = Mode::Auto, fanMode = Mode::Auto;
bool lampAuto = false, fanAuto = false, alarmOn = false, doorOpen = false;
bool buttonWasPressed = false;
bool stateDirty = true;
float temperature = NAN, humidity = NAN;
unsigned long doorOpenedAt = 0, lastDhtRead = 0, lastState = 0, lastConnect = 0;
unsigned long lastWifiReport = 0;
bool wifiWasConnected = false;

void setDoor(bool open) {
  if (open) doorOpenedAt = millis();
  doorOpen = open;
  stateDirty = true;
  const int duty = open ? 4915 : 3277;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(SERVO_PIN, duty);
#else
  ledcWrite(SERVO_CHANNEL, duty);
#endif
}

bool parseMode(const char* value, Mode& mode) {
  if (strcmp(value, "AUTO") == 0) mode = Mode::Auto;
  else if (strcmp(value, "ON") == 0) mode = Mode::On;
  else if (strcmp(value, "OFF") == 0) mode = Mode::Off;
  else return false;
  return true;
}

const char* modeName(Mode mode) {
  if (mode == Mode::On) return "ON";
  if (mode == Mode::Off) return "OFF";
  return "AUTO";
}

void onCommand(char* topic, byte* payload, unsigned int length) {
  if (length == 0 || length > 5 || memchr(payload, 0, length)) return;
  char value[6] = {};
  memcpy(value, payload, length);
  if (strcmp(topic, HOME_TOPIC "/cmd/lamp") == 0) {
    stateDirty |= parseMode(value, lampMode);
  } else if (strcmp(topic, HOME_TOPIC "/cmd/fan") == 0) {
    stateDirty |= parseMode(value, fanMode);
  } else if (strcmp(topic, HOME_TOPIC "/cmd/door") == 0) {
    if (strcmp(value, "OPEN") == 0) setDoor(true);
    if (strcmp(value, "CLOSE") == 0) setDoor(false);
  }
}

void serviceMqtt(unsigned long now) {
  const bool wifiConnected = WiFi.status() == WL_CONNECTED;
  if (wifiConnected && !wifiWasConnected) {
    Serial.print("WiFi connected, IP: ");
    Serial.println(WiFi.localIP());
    Serial.printf("Connecting MQTT: %s:%d\n", MQTT_HOST, MQTT_PORT);
  } else if (!wifiConnected && wifiWasConnected) {
    Serial.println("WiFi disconnected; reconnecting...");
  }
  wifiWasConnected = wifiConnected;
  if (!wifiConnected) {
    if (now - lastWifiReport >= 5000) {
      lastWifiReport = now;
      Serial.printf("Waiting for Wokwi-GUEST, WiFi status: %d\n", WiFi.status());
    }
    return;
  }
  if (!mqtt.connected() && now - lastConnect >= 5000) {
    lastConnect = now;
    char clientId[40];
    snprintf(clientId, sizeof(clientId), "smart-home-%08lx", (unsigned long)esp_random());
    if (mqtt.connect(clientId)) {
      mqtt.subscribe(COMMAND_PATTERN);
      stateDirty = true;
      Serial.println("MQTT connected");
    } else {
      Serial.printf("MQTT retry: %d\n", mqtt.state());
    }
  }
  if (mqtt.connected()) mqtt.loop();
}

void jsonFloat(char* value, size_t size, float number) {
  if (isfinite(number)) snprintf(value, size, "%.1f", number);
  else snprintf(value, size, "null");
}

void setup() {
  Serial.begin(115200);
  dht.setup(DHT_PIN, DHTesp::DHT22);
  pinMode(PIR_PIN, INPUT);
  pinMode(ARM_PIN, INPUT_PULLUP);
  pinMode(DOOR_BUTTON_PIN, INPUT_PULLUP);
  pinMode(LAMP_PIN, OUTPUT);
  pinMode(FAN_PIN, OUTPUT);
  analogReadResolution(12);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(SERVO_PIN, 50, 16);
  ledcAttach(BUZZER_PIN, 2200, 8);
#else
  ledcSetup(SERVO_CHANNEL, 50, 16);
  ledcAttachPin(SERVO_PIN, SERVO_CHANNEL);
  ledcSetup(BUZZER_CHANNEL, 2200, 8);
  ledcAttachPin(BUZZER_PIN, BUZZER_CHANNEL);
#endif
  setDoor(false);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onCommand);
  mqtt.setBufferSize(512);
  mqtt.setSocketTimeout(2);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  Serial.println("Connecting WiFi: Wokwi-GUEST (no password)");
  WiFi.begin("Wokwi-GUEST", "", 6);
}

void loop() {
  const unsigned long now = millis();
  const int light = analogRead(LDR_PIN);
  if (light >= 2400) lampAuto = true;
  if (light <= 1900) lampAuto = false;

  if (now - lastDhtRead >= 2200) {
    lastDhtRead = now;
    const TempAndHumidity reading = dht.getTempAndHumidity();
    temperature = reading.temperature;
    humidity = reading.humidity;
    if (temperature >= 30) fanAuto = true;
    if (temperature <= 28) fanAuto = false;
  }

  const bool lamp = lampMode == Mode::Auto ? lampAuto : lampMode == Mode::On;
  const bool fan = fanMode == Mode::Auto ? fanAuto : fanMode == Mode::On;
  digitalWrite(LAMP_PIN, lamp);
  digitalWrite(FAN_PIN, fan);

  const bool armed = digitalRead(ARM_PIN) == LOW;
  const bool motion = digitalRead(PIR_PIN) == HIGH;
  const bool shouldAlarm = armed && motion;
  if (shouldAlarm != alarmOn) {
    alarmOn = shouldAlarm;
    stateDirty = true;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWriteTone(BUZZER_PIN, alarmOn ? 2200 : 0);
#else
    ledcWriteTone(BUZZER_CHANNEL, alarmOn ? 2200 : 0);
#endif
  }
  const bool pressed = digitalRead(DOOR_BUTTON_PIN) == LOW;
  if (pressed && !buttonWasPressed) setDoor(true);
  buttonWasPressed = pressed;
  if (doorOpen && millis() - doorOpenedAt >= DOOR_OPEN_MS) setDoor(false);

  if (mqtt.connected() && (stateDirty || now - lastState >= 1500)) {
    char temp[16], hum[16], message[256];
    jsonFloat(temp, sizeof(temp), temperature);
    jsonFloat(hum, sizeof(hum), humidity);
    snprintf(message, sizeof(message),
      R"json({"temperature":%s,"humidity":%s,"light":%d,"motion":%s,"armed":%s,"alarm":%s,"lamp":%s,"fan":%s,"door":%s,"lampMode":"%s","fanMode":"%s"})json",
      temp, hum, light, motion ? "true" : "false", armed ? "true" : "false",
      alarmOn ? "true" : "false", lamp ? "true" : "false", fan ? "true" : "false",
      doorOpen ? "true" : "false", modeName(lampMode), modeName(fanMode));
    if (mqtt.publish(STATE_TOPIC, message)) {
      lastState = now;
      stateDirty = false;
    }
  }
  serviceMqtt(now);
  delay(15);
}
