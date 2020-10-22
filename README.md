
A node.js module to interface with the [netatmo api](http://dev.netatmo.com/) API.

This module is a complete rewrite of https://github.com/floetenbaer/netatmo/

Documentation is an ongoing process. To be updated ASAP.

## Getting Starting

1. Make sure you have a netatmo account.
2. Make sure you have at least one netatmo device set up.

## Install

```sh
git clone https://github.com/Darkzor/drk-netatmo.git
```

or

```
npm install @darkzor/drk-netatmo@0.1.0
```

## Example #1

```javascript
var netatmo = require('netatmo');

var auth = {
  "client_id": "",
  "client_secret": "",
  "username": "",
  "password": "",
};

var api = new netatmo(auth);

// Get Home Data
// https://dev.netatmo.com/apidocumentation/security#gethomedata
api.getHomeData(function(err, body) {
  console.log(body);
});

// Get Stations Data
// See docs: https://dev.netatmo.com/dev/resources/technical/reference/weatherstation/getstationsdata
api.getStationsData(function(err, body) {
  console.log(body.devices);
});


## License

MIT © [Radu Oprisan](https://oprisan.info)
