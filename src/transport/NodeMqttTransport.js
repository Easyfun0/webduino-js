module.exports = function (scope) {
  'use strict';

  var mqtt = require('mqtt');

  var push = Array.prototype.push;

  var Transport = scope.Transport,
    TransportEvent = scope.TransportEvent,
    util = scope.util,
    proto;

  var STATUS = {
    OK: 'OK'
  };

  var TOPIC = {
    PING: '/PING',
    PONG: '/PONG',
    STATUS: '/STATUS'
  };

  var MQTT_EVENTS = {
    CONNECT: 'connect',
    MESSAGE: 'message',
    CLOSE: 'close',
    ERROR: 'error'
  };

  function NodeMqttTransport(options) {
    Transport.call(this, options);

    this._options = options;
    this._client = null;
    this._sendTimer = null;
    this._status = '';
    this._buf = [];
    this._isReady = false;

    this._connHandler = onConnect.bind(this);
    this._messageHandler = onMessage.bind(this);
    this._sendOutHandler = sendOut.bind(this);
    this._disconnHandler = onDisconnect.bind(this);
    this._errorHandler = onError.bind(this);

    init(this);
  }

  function init(self) {
    self._client = mqtt.connect(self._options.url, {
      clientId: '_' + self._options.device + (self._options.multi ? '.' + util.randomId() : ''),
      username: self._options.login || '',
      password: new Buffer(self._options.password || ''),
      keepalive: NodeMqttTransport.KEEPALIVE_INTERVAL,
      reconnectPeriod: self._options.autoReconnect ? NodeMqttTransport.RECONNECT_PERIOD * 1000 : 0,
      connectTimeout: NodeMqttTransport.CONNECT_TIMEOUT * 1000
    });
    self._client.on(MQTT_EVENTS.CONNECT, self._connHandler);
    self._client.on(MQTT_EVENTS.MESSAGE, self._messageHandler);
    self._client.on(MQTT_EVENTS.CLOSE, self._disconnHandler);
    self._client.on(MQTT_EVENTS.ERROR, self._errorHandler);
  }

  function onConnect() {
    this._isReady = true;
    this.emit(TransportEvent.OPEN);
    this._client.subscribe(this._options.device + TOPIC.PONG);
    this._client.subscribe(this._options.device + TOPIC.STATUS);
  }

  function onMessage(topic, message, packet) {
    var dest = topic,
      oldStatus = this._status;

    switch (dest.substr(dest.lastIndexOf('/') + 1)) {
    case 'STATUS':
      this._status = message.toString();
      detectStatusChange(this, this._status, oldStatus);
      break;
    default:
      this.emit(TransportEvent.MESSAGE, message);
      break;
    }
  }

  function detectStatusChange(self, newStatus, oldStatus) {
    if (newStatus === oldStatus) {
      return;
    }

    if (newStatus === STATUS.OK) {
      self.emit(TransportEvent.READY);
    } else {
      self.emit(TransportEvent.ERROR, new Error('error: board connection failed. (1)'));
    }
  }

  function onDisconnect() {
    this.emit(TransportEvent.ERROR, new Error('error: board connection failed. (2)'));

    if (this._isReady) {
      this._isReady = false;
      delete this._client;
      this.emit(TransportEvent.CLOSE);
    }
  }

  function onError(error) {
    this.emit(TransportEvent.ERROR, error);
  }

  function sendOut() {
    var payload = new Buffer(this._buf);
    this._client.publish(this._options.device + TOPIC.PING, payload, {
      qos: 0
    });
    clearBuf(this);
  }

  function clearBuf(self) {
    self._buf = [];
    clearImmediate(self._sendTimer);
    self._sendTimer = null;
  }

  NodeMqttTransport.prototype = proto = Object.create(Transport.prototype, {

    constructor: {
      value: NodeMqttTransport
    },

    isReady: {
      get: function () {
        return this._isReady;
      }
    }

  });

  proto.send = function (payload) {
    if (this._buf.length + payload.length + this._options.device.length + TOPIC.PING.length + 4 >
      NodeMqttTransport.MAX_PACKET_SIZE) {
      this._sendOutHandler();
    }
    push.apply(this._buf, payload);
    if (!this._sendTimer) {
      this._sendTimer = setImmediate(this._sendOutHandler);
    }
  };

  proto.close = function () {
    if (this._isReady) {
      this._client.end();
    }
  };

  NodeMqttTransport.RECONNECT_PERIOD = 1;

  NodeMqttTransport.KEEPALIVE_INTERVAL = 15;

  NodeMqttTransport.CONNECT_TIMEOUT = 30;

  NodeMqttTransport.MAX_PACKET_SIZE = 128;

  scope.transport.mqtt = NodeMqttTransport;
};