/**
 * Created by colinhan on 17/02/2017.
 */

const co = require('co');
const socketio = require('socket.io');
const logger = require('p2m-common-logger')('socket-io');

const channelId = 'socket-io';
let socket = null;
let connections = {};

export default function channel(options) {
  function* clearOldDevice() {
    yield options.models.Device.update({
          isDeleted: true
        },
        {
          where: {channel: channelId}
        });
  }

  function start(app, server) {
    logger.log('Starting socket-io service...');
    if (socket) {
      logger.warn('Service was started.');
      return;
    }

    co(clearOldDevice)
        .then(function () {
          socket = socketio.listen(server).of(options.path);
          socket.on('connection', onConnect);
          logger.log('Socket-io service started.')
        })
        .catch(function (err) {
          logger.log('Error occurred when clear old devices, starting socket-io device is failed. Error message is %j', err);
        });
  }

  function stop() {
    logger.log('Stopping socket-io service...');
    if (!socket) {
      logger.error('Service is not started.');
      return;
    }

    socket.close();
    socket = undefined;
  }

  function onConnect(socket) {
    logger.log('A new connection coming, socket\'s id is "%s"', socket.id);

    if (socket.id in connections) {
      logger.error('Connection is existed. Some error occurred.');
    }
    connections[socket.id] = socket;

    socket.on('disconnect', onDisconnect.bind(null, socket));
    socket.on('register', onRegister.bind(null, socket));
  }

  function onDisconnect(socket) {
    if (socket.id in connections) {
      if (socket.isRegistered) {
        unregisterDevice(socket.id);
      }
      delete connections[socket.id];
    } else {
      logger.error('Cannot find specified connection. Some error occurred.');
    }
  }

  function onRegister(socket, {userId}) {
    socket.isRegistered = true;
    registerDevice(socket.id, userId, socket);
  }

  function registerDevice(deviceId, userId, socket) {
    logger.log('New device registering... "%j"', {deviceId, userId});
    connections[deviceId] = socket;
    options.models.Device.create({
      deviceId,
      userId,
      channel: channelId
    }).then(function () {
      logger.log('Device "%s" register completed.', deviceId);
    }).catch(function (err) {
      logger.error('Device "%s" register failed with error "%j"', deviceId, err);
    })
  }

  function unregisterDevice(deviceId) {
    logger.log('Device "%s" unregistering...', deviceId);
    delete connections[deviceId];
    options.models.Device.destroy({
      where: {deviceId}
    }).then(function (count) {
      if (count !== 1) {
        logger.error('Unregister device with an unexpected result. Should remove 1 device, but %d devices removed.', count);
      } else {
        logger.log('Device "%s" unregistered.', deviceId);
      }
    }).catch(function (err) {
      logger.error('Unregister device "%s" failed with error: %s', deviceId, err);
    })
  }

  function send(device, message) {
    if (!connections[device.deviceId]) {
      logger.error('Specified device "%s" is not found.', deviceId);
      return;
    }

    let conn = connections[device.deviceId];
    conn.emit('push-message', message);
  }

  return {
    channelId,
    start,
    stop,
    send,
  };
}