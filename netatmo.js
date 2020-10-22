var util = require('util');
var EventEmitter = require("events").EventEmitter;
var request = require('request');
var moment = require('moment');

const BASE_URL = 'https://api.netatmo.com';

var username;
var password;
var client_id;
var client_secret;
var scope;
var access_token;

/**
 * @constructor
 * @param args
 */
var netatmo = function (args) {
  EventEmitter.call(this);
  this.authenticate(args);
};

util.inherits(netatmo, EventEmitter);

/**
 * handleRequestError
 * @param err
 * @param response
 * @param body
 * @param message
 * @param critical
 * @returns {Error}
 */
netatmo.prototype.handleRequestError = function (err, response, body, message, critical) {
  var errorMessage = "";
  if (body && response.headers["content-type"].trim().toLowerCase().indexOf("application/json") !== -1) {
    errorMessage = JSON.parse(body);
    errorMessage = errorMessage && (errorMessage.error.message || errorMessage.error);
  } else if (typeof response !== 'undefined') {
    errorMessage = "Status code" + response.statusCode;
  }
  else {
    errorMessage = "No response";
  }
  var error = new Error(message + ": " + errorMessage);
  if (critical) {
    this.emit("error", error);
  } else {
    this.emit("warning", error);
  }
  return error;
};

/**
 * https://dev.netatmo.com/apidocumentation/oauth
 * @param args
 * @param callback
 * @returns {netatmo}
 */
netatmo.prototype.authenticate = function (args, callback) {
  if (!args) {
    this.emit("error", new Error("Authenticate 'args' not set."));
    return this;
  }

  if (args.access_token) {
    access_token = args.access_token;
    return this;
  }

  if (!args.client_id) {
    this.emit("error", new Error("Authenticate 'client_id' not set."));
    return this;
  }

  if (!args.client_secret) {
    this.emit("error", new Error("Authenticate 'client_secret' not set."));
    return this;
  }

  scope = args.scope || 'read_station read_thermostat write_thermostat read_camera write_camera access_camera read_presence access_presence read_smokedetector read_homecoach';

  var form = {client_id: args.client_id, client_secret: args.client_secret, scope: scope};
  if(args.username && args.password) {
    form['grant_type'] = "password";
    form['username'] = args.username;
    form['password'] = args.password;
  }
  else if(args.code) {
    form['grant_type'] = "authorization_code";
    form['code'] = args.code;
  }
  else {
    this.emit("error", new Error("No valid authentication parameters set."));
    return this;
  }

  if(args.redirect_uri) {
    form['redirect_uri'] = args.redirect_uri;
  }

  var url = util.format('%s/oauth2/token', BASE_URL);
  console.log(form);
  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      console.log(body);
      return this.handleRequestError(err, response, body, "Authenticate error", true);
    }

    body = JSON.parse(body);

    access_token = body.access_token;

    if (body.expires_in) {
      setTimeout(this.authenticate_refresh.bind(this), body.expires_in * 1000, body.refresh_token);
    }

    this.emit('authenticated');

    if (callback) {
      return callback();
    }

    return this;
  }.bind(this));

  return this;
};

/**
 * https://dev.netatmo.com/apidocumentation/oauth#refreshing-a-token
 * @param refresh_token
 * @returns {netatmo}
 */
netatmo.prototype.authenticate_refresh = function (refresh_token) {

  var form = {
    grant_type: 'refresh_token',
    refresh_token: refresh_token,
    client_id: client_id,
    client_secret: client_secret,
  };

  var url = util.format('%s/oauth2/token', BASE_URL);

  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "Authenticate refresh error");
    }

    body = JSON.parse(body);

    access_token = body.access_token;

    if (body.expires_in) {
      setTimeout(this.authenticate_refresh.bind(this), body.expires_in * 1000, body.refresh_token);
    }

    return this;
  }.bind(this));

  return this;
};

/**
 * Weather
 * https://dev.netatmo.com/apidocumentation/weather#getpublicdata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getPublicData = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getPublicData(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("getPublicData 'options' not set."));
    return this;
  }

  if(!this.validateRequiredParams("getPublicData", options, ['lat_ne', 'lon_ne', 'lat_sw', 'lon_sw']))
    return this;

  if (Array.isArray(options.required_data)) {
    options.required_data = options.required_data.join(',');
  }

  // Remove any spaces from the type list if there is any.
  options.required_data = options.required_data.replace(/\s/g, '').toLowerCase();

  var url = util.format('%s/api/getpublicdata', BASE_URL);

  this.makeAuthenticatedGetRequest(url, options, function (err, response, body) {
    if (err || response.statusCode != 200) {
      var error = this.handleRequestError(err, response, body, "getPublicData error");
      if (callback) {
        callback(error);
      }
      return;
    }

    body = JSON.parse(body);

    var measure = body.body;

    this.emit('get-publicdata', err, measure);

    if (callback) {
      return callback(err, measure);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * Weather
 * https://dev.netatmo.com/apidocumentation/weather#getstationsdata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getStationsData = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getStationsData(options, callback);
    });
  }

  if (options != null && callback == null) {
    callback = options;
    options = null;
  }

  var url = util.format('%s/api/getstationsdata', BASE_URL);

  this.makeAuthenticatedGetRequest(url, options, function(err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getStationsDataError error");
    }

    body = JSON.parse(body);

    body = body.body;

    this.emit('get-stationsdata', err, body);

    if (callback) {
      return callback(err, body);
    }

    return this;
  }.bind(this));

  return this;
};

/**
 * Weather, Energy
 * https://dev.netatmo.com/apidocumentation/weather#getmeasure
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getMeasure = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getMeasure(options, callback);
    });
  }
  if (!options) {
    this.emit("error", new Error("getMeasure 'options' not set."));
    return this;
  }

  if(!this.validateRequiredParams("getMeasure", options, ['device_id', 'scale', 'type']))
    return this;

  if (Array.isArray(options.type)) {
    options.type = options.type.join(',');
  }

  // Remove any spaces from the type list if there is any.
  options.type = options.type.replace(/\s/g, '').toLowerCase();


  var url = util.format('%s/api/getmeasure', BASE_URL);

  var processesed_options = {
    device_id: options.device_id,
    scale: options.scale,
    type: options.type,
  };

  if (options) {

    if (options.module_id) {
      processesed_options.module_id = options.module_id;
    }

    if (options.date_begin) {
      if (options.date_begin <= 1E10) {
        options.date_begin *= 1E3;
      }

      processesed_options.date_begin = moment(options.date_begin).utc().unix();
    }

    if (options.date_end === 'last') {
      processesed_options.date_end = 'last';
    } else if (options.date_end) {
      if (options.date_end <= 1E10) {
        options.date_end *= 1E3;
      }
      processesed_options.date_end = moment(options.date_end).utc().unix();
    }

    if (options.limit) {
      processesed_options.limit = parseInt(options.limit, 10);

      if (processesed_options.limit > 1024) {
        processesed_options.limit = 1024;
      }
    }

    if (options.optimize !== undefined) {
      processesed_options.optimize = !!options.optimize;
    }

    if (options.real_time !== undefined) {
      processesed_options.real_time = !!options.real_time;
    }
  }

  this.makeAuthenticatedGetRequest(url, processesed_options, function (err, response, body) {
    if (err || response.statusCode != 200) {
      var error = this.handleRequestError(err, response, body, "getMeasure error");
      if (callback) {
        callback(error);
      }
      return;
    }

    body = JSON.parse(body);

    var measure = body.body;

    this.emit('get-measure', err, measure);

    if (callback) {
      return callback(err, measure);
    }

    return this;
  }.bind(this));

  return this;
};

/**
 * Security
 * https://dev.netatmo.com/apidocumentation/security#gethomedata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getHomeData = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getHomeData(options, callback);
    });
  }

  if (options != null && callback == null) {
    callback = options;
    options = null;
  }
  required_params = [];
  return this.simpleGetRequest("getHomeData", "/api/gethomedata", options, required_params, callback, "get-homedata");
};

/**
 * Security
 * https://dev.netatmo.com/apidocumentation/security#geteventsuntil
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getEventsUntil = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getEventsUntil(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("getEventsUntil 'options' not set."));
    return this;
  }

  if(!this.validateRequiredParams("getEventsUntil", options, ['home_id', 'event_id']))
    return this;

  var url = util.format('%s/api/geteventsuntil', BASE_URL);

  this.makeAuthenticatedGetRequest(url, options, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getEventsUntil error");
    }

    body = JSON.parse(body);

    this.emit('get-eventsuntil', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * Security
 * https://dev.netatmo.com/apidocumentation/security#getlasteventof
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getLastEventOf = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getLastEventOf(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("getLastEventOf 'options' not set."));
    return this;
  }

  if(!this.validateRequiredParams("getLastEventOf", options, ['home_id', 'person_id']))
    return this;

  var url = util.format('%s/api/getlasteventof', BASE_URL);

  this.makeAuthenticatedGetRequest(url, options, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getLastEventOf error");
    }

    body = JSON.parse(body);

    this.emit('get-lasteventof', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * Security
 * https://dev.netatmo.com/apidocumentation/security#getnextevents
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getNextEvents = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getNextEvents(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("getNextEvents 'options' not set."));
    return this;
  }

  if(!this.validateRequiredParams("getNextEvents", options, ['home_id', 'event_id']))
    return this;

  var url = util.format('%s/api/getnextevents', BASE_URL);

  this.makeAuthenticatedGetRequest(url, options, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getNextEvents error");
    }

    body = JSON.parse(body);

    this.emit('get-nextevents', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
};

/**
 * Security
 * https://dev.netatmo.com/apidocumentation/security#getcamerapicture
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getCameraPicture = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getCameraPicture(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("getCameraPicture 'options' not set."));
    return this;
  }

  if(!this.validateRequiredParams("getCameraPicture", options, ['image_id', 'key']))
    return this;

  var url = util.format('%s/api/getcamerapicture', BASE_URL);

  this.makeAuthenticatedGetRequest(url, options, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "getCameraPicture error");
    }

    this.emit('get-camerapicture', err, body);

    if (callback) {
      return callback(err, body);
    }

    return this;

  }.bind(this))

  return this;
};

/**
 * Security
 * https://dev.netatmo.com/apidocumentation/security#setpersonsaway
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setPersonsAway = function(options, callback) {
    // Wait until authenticated.
    if (!access_token) {
      return this.on('authenticated', function () {
        this.getCameraPicture(options, callback);
      });
    }
  
    if (!options) {
      this.emit("error", new Error("setPersonsAway 'options' not set."));
      return this;
    }
  
    if(!this.validateRequiredParams("setPersonsAway", options, ['home_id']))
      return this;
  
    var url = util.format('%s/api/setpersonsaway', BASE_URL);

    this.makeAuthenticatedPostRequest(url, options, function (err, response, body) {
      if (err || response.statusCode != 200) {
        return this.handleRequestError(err, response, body, "setPersonsAway error");
      }
  
      body = JSON.parse(body);
  
      this.emit('set-personsaway', err, body.body);
  
      if (callback) {
        return callback(err, body.body);
      }
  
      return this;
  
    }.bind(this));

    return this;
}

/**
 * Security
 * https://dev.netatmo.com/apidocumentation/security#setpersonshome
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setPersonsHome = function(options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getCameraPicture(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("setPersonsHome 'options' not set."));
    return this;
  }

  if(!this.validateRequiredParams("setPersonsHome", options, ['home_id']))
    return this;

  var url = util.format('%s/api/setpersonshome', BASE_URL);

  this.makeAuthenticatedPostRequest(url, options, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "setPersonsHome error");
    }

    body = JSON.parse(body);

    this.emit('set-personshome', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
}

/**
 * Security
 * https://dev.netatmo.com/apidocumentation/security#addwebhook
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.addWebHook = function(options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getCameraPicture(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("addWebHook 'options' not set."));
    return this;
  }

  if(!this.validateRequiredParams("addWebHook", options, ['url']))
    return this;

  var url = util.format('%s/api/addwebhook', BASE_URL);

  this.makeAuthenticatedPostRequest(url, options, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "addWebHook error");
    }

    body = JSON.parse(body);

    this.emit('set-addwebhook', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
}

/**
 * Security
 * https://dev.netatmo.com/apidocumentation/security#dropwebhook
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.dropWebHook = function(options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getCameraPicture(options, callback);
    });
  }

  if (!options) {
    this.emit("error", new Error("dropWebHook 'options' not set."));
    return this;
  }

  if(!this.validateRequiredParams("dropWebHook", options, []))
    return this;

  var url = util.format('%s/api/dropwebhook', BASE_URL);

  this.makeAuthenticatedPostRequest(url, options, function (err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, "dropWebHook error");
    }

    body = JSON.parse(body);

    this.emit('set-dropwebhook', err, body.body);

    if (callback) {
      return callback(err, body.body);
    }

    return this;

  }.bind(this));

  return this;
}

/**
 * Energy
 * https://dev.netatmo.com/apidocumentation/energy#homesdata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.homesData = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.homesData(options, callback);
    });
  }

  return this.simpleGetRequest("homesData", "/api/homesdata", options, [], callback, "get-homesdata");
};

/**
 * Energy
 * https://dev.netatmo.com/apidocumentation/energy#homestatus
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.homeStatus = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.homeStatus(options, callback);
    });
  }

  return this.simpleGetRequest("homeStatus", "/api/homestatus", options, ['home_id'], callback, "get-homestatus");
};

/**
 * Energy
 * https://dev.netatmo.com/apidocumentation/energy#createnewhomeschedule
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.createNewHomeSchedule = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.createNewHomeSchedule(options, callback);
    });
  }

  return this.simplePostRequest("createNewHomeSchedule", "/api/createnewhomeschedule", options, ['home_id', 'timetable', 'zone', 'name', 'hg_temp', 'away_temp'],
    callback, "set-createnewhomeschedule");
};

/**
 * Energy
 * https://dev.netatmo.com/apidocumentation/energy#deletehomeschedule
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.deleteHomeSchedule = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.deleteHomeSchedule(options, callback);
    });
  }

  return this.simplePostRequest("deleteHomeSchedule", "/api/deletehomeschedule", options, ['home_id', 'schedule_id'], callback, "set-createnewhomeschedule");
};

/**
 * Energy
 * https://dev.netatmo.com/apidocumentation/energy#renamehomeschedule
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.renameHomeSchedule = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.homeStatus(options, callback);
    });
  }

  return this.homeStatus("renameHomeSchedule", "/api/renamehomeschedule", options, ['home_id', 'schedule_id', 'name'], callback, "set-renamehomeschedule");
};

/**
 * Energy
 * https://dev.netatmo.com/apidocumentation/energy#synchomeschedule
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.syncHomeSchedule = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.syncHomeSchedule(options, callback);
    });
  }

  return this.simplePostRequest("syncHomeSchedule", "/api/synchomeschedule", options, ['home_id', 'zones', 'timetable', 'hg_temp', 'away_temp'],
    callback, "set-synchomeschedule");
};

/**
 * Energy
 * https://dev.netatmo.com/apidocumentation/energy#switchhomeschedule
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.switchHomeSchedule = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.switchHomeSchedule(options, callback);
    });
  }

  return this.simplePostRequest("switchHomeSchedule", "/api/switchhomeschedule", options, ['schedule_id', 'home_id'], callback, "set-switchhomeschedule");
};

/**
 * Energy
 * https://dev.netatmo.com/apidocumentation/energy#getroommeasure
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getRoomMeasure = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getRoomMeasure(options, callback);
    });
  }
  if(!this.validateRequiredParams("getRoomMeasure", options, ['home_id', 'room_id', 'scale', 'type']))
    return this;

  if (Array.isArray(options.type)) {
    options.type = options.type.join(',');
  }

  // Remove any spaces from the type list if there is any.
  options.type = options.type.replace(/\s/g, '').toLowerCase();


  var url = util.format('%s/api/getroommeasure', BASE_URL);

  var processesed_options = {
    home_id: options.home_id,
    room_id: options.room_id,
    scale: options.scale,
    type: options.type
  };

  if (options.date_begin) {
    if (options.date_begin <= 1E10) {
      options.date_begin *= 1E3;
    }

    processesed_options.date_begin = moment(options.date_begin).utc().unix();
  }

  if (options.date_end === 'last') {
    processesed_options.date_end = 'last';
  } else if (options.date_end) {
    if (options.date_end <= 1E10) {
      options.date_end *= 1E3;
    }
    processesed_options.date_end = moment(options.date_end).utc().unix();
  }

  if (options.limit) {
    processesed_options.limit = parseInt(options.limit, 10);

    if (processesed_options.limit > 1024) {
      processesed_options.limit = 1024;
    }
  }

  if (options.optimize !== undefined) {
    processesed_options.optimize = !!options.optimize;
  }

  if (options.real_time !== undefined) {
    processesed_options.real_time = !!options.real_time;
  }

  this.makeAuthenticatedGetRequest(url, processesed_options, function (err, response, body) {
    if (err || response.statusCode != 200) {
      var error = this.handleRequestError(err, response, body, "getRoomMeasure error");
      if (callback) {
        callback(error);
      }
      return;
    }

    body = JSON.parse(body);

    var measure = body.body;

    this.emit('get-roommeasure', err, measure);

    if (callback) {
      return callback(err, measure);
    }

    return this;
  }.bind(this));

  return this;
};

/**
 * Energy
 * https://dev.netatmo.com/apidocumentation/energy#setroomthermpoint
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setRoomThermPoint = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.setRoomThermPoint(options, callback);
    });
  }

  return this.simplePostRequest("setRoomThermPoint", "/api/setroomthermpoint", options, ['home_id', 'room_id', 'mode'], callback, "set-setroomthermpoint");
};

/**
 * Energy
 * https://dev.netatmo.com/apidocumentation/energy#setthermmode
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.setThermMode = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.setThermMode(options, callback);
    });
  }

  return this.simplePostRequest("setThermMode", "/api/setthermmode", options, ['home_id', 'mode'], callback, "set-setthermmode");
};


/**
 * Aircare
 * https://dev.netatmo.com/apidocumentation/aircare#gethomecoachsdata
 * @param options
 * @param callback
 * @returns {*}
 */
netatmo.prototype.getHomeCoachsData = function (options, callback) {
  // Wait until authenticated.
  if (!access_token) {
    return this.on('authenticated', function () {
      this.getHomeCoachsData(options, callback);
    });
  }

  return this.simpleGetRequest("getHomeCoachsData", "/api/gethomecoachsdata", options, [], callback, "get-homecoachesdata");
};

netatmo.prototype.makeAuthenticatedGetRequest = function (url, qs, callback) {
  if(!qs) {
    qs = {};
  }

  request({
    url: url,
    method: "GET",
    qs: qs,
    headers: {'Authorization': util.format('Bearer %s', access_token)}
  }, function (err, response, body) {
    return callback(err, response, body);
  }.bind(this));
}

netatmo.prototype.makeAuthenticatedPostRequest = function (url, form, callback) {
  form['access_token'] = access_token
  request({
    url: url,
    method: "POST",
    form: form,
  }, function (err, response, body) {
    return callback(err, response, body);
  }.bind(this));
}

netatmo.prototype.validateRequiredParams = function (f, options, required_params) {
  if(required_params.length > 0) {
    if(!options) {
      this.emit("error", new Error("Options not set."));
    }
  }
  for(var i=0; i < required_params.length; i++) {
    if(!Object.keys(options).includes(required_params[i])) {
      this.emit("error", new Error(util.format("%s '%s' not set.", f, required_params[i])));
      return false;
    }
  }
  return true;
}

netatmo.prototype.simpleGetRequest = function(f, url, options, required_params, callback, emit_label) {
  if (options != null && callback == null) {
    callback = options;
    options = null;
  }
  if(!this.validateRequiredParams(f, options, required_params))
    return this;
  var full_url = util.format('%s%s', BASE_URL, url);
  this.makeAuthenticatedGetRequest(full_url, options, function(err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, util.format("%s error", f));
    }
    body = JSON.parse(body);
    this.emit(emit_label, err, body.body);
    if (callback) {
      return callback(err, body.body);
    }
    return this;
  }.bind(this));
  return this;
}

netatmo.prototype.simplePostRequest = function(f, url, options, required_params, callback, emit_label) {
  if (options != null && callback == null) {
    callback = options;
    options = null;
  }
  if(!this.validateRequiredParams(f, options, required_params))
    return this;
  var full_url = util.format('%s%s', BASE_URL, url);
  this.makeAuthenticatedPostRequest(full_url, options, function(err, response, body) {
    if (err || response.statusCode != 200) {
      return this.handleRequestError(err, response, body, util.format("%s error", f));
    }
    body = JSON.parse(body);
    this.emit(emit_label, err, body.body);
    if (callback) {
      return callback(err, body.body);
    }
    return this;
  }.bind(this));
  return this;
}

module.exports = netatmo;
