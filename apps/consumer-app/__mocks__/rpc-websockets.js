function CommonClient() {}
CommonClient.prototype.on = function() {};
CommonClient.prototype.connect = function() {};
CommonClient.prototype.call = function() {};
CommonClient.prototype.send = function() {};
CommonClient.prototype.close = function() {};

function Client() {}
Client.prototype = Object.create(CommonClient.prototype);

function WebSocket() {
  return {
    socket: { readyState: 1 },
    on: function() {},
    connect: function() {},
    call: function() {},
    send: function() {},
    close: function() {}
  };
}

module.exports = {
  __esModule: true,
  CommonClient: CommonClient,
  Client: Client,
  WebSocket: WebSocket,
  default: Client
};
