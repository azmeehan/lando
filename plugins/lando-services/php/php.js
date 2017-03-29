/**
 * Lando php service builder
 *
 * @name php
 */

'use strict';

module.exports = function(lando) {

  // Modules
  var _ = require('lodash');
  var addConfig = lando.services.addConfig;
  var addScript = lando.services.addScript;
  var buildVolume = lando.services.buildVolume;

  // "Constants"
  var defaultConfDir = lando.config.engineConfigDir;

  /**
   * Supported versions for php
   */
  var versions = [
    '5.3',
    '5.5',
    '5.6',
    '7.0',
    'latest',
    'custom'
  ];

  /*
   * Parse our config
   */
  var parseConfig = function(config) {

    // Get the version and type
    var version = config.version || '7.0';
    var type = config.via.split(':')[0] || 'nginx';

    // Define type specific config things
    var typeConfig = {
      nginx: {
        type: type,
        command: ['php-fpm'],
        image: [version, 'fpm'].join('-'),
        serverConf: '/etc/nginx/conf.d/default.conf'
      },
      apache: {
        type: type,
        command: ['apache2-foreground'],
        image: [version, 'apache'].join('-'),
        serverConf: '/etc/apache2/sites-available/000-default.conf',
      }
    };

    // Add the docker php entrypoint if we are on a supported php version
    if (version.split('.').join('') > 55) {
      typeConfig[type].command.unshift('docker-php-entrypoint');
    }

    // Return type specific config
    return _.merge(config, typeConfig[type]);

  };

  /*
   * Build php
   */
  var php = function(config) {

    // Start with the php base
    var php = {
      image: 'kalabox/php:' + config.image,
      environment: {
        TERM: 'xterm'
      },
      ports: ['80'],
      volumes: [],
      command: config.command.join(' '),
      'volumes_from': ['data']
    };

    // If this is apache lets do some checks
    if (config.type === 'apache' && config.ssl) {

      // Add the ssl port
      php.ports.push('443');

      // If we don't have a custom default ssl config lets use the default one
      var sslConf = ['php', 'httpd-ssl.conf'];
      var sslVolume = buildVolume(sslConf, config.serverConf, defaultConfDir);
      php.volumes = addConfig(sslVolume, php.volumes);

      // Add in an add cert task
      php.volumes = addScript('add-cert.sh');

    }

    // REturn the service
    return php;

  };

  /*
   * Build nginx
   */
  var nginx = function(config) {

    // Add a version to the type if applicable
    var type = [config.type, config.via.split(':')[1]].join(':');

    // Handle our nginx config
    var defaultConfFile = (config.ssl) ? 'default-ssl.conf' : 'default.conf';
    var configFile = ['php', defaultConfFile];
    var mount = buildVolume(configFile, config.serverConf, defaultConfDir);
    var nginxConfigDefaults = {
      server: mount.split(':')[0]
    };

    // Set the nginx config
    config.config = _.merge(nginxConfigDefaults, config.config);

    // Generate a config object to build the service with
    var nginx = lando.services.build(config.name, type, config)[config.name];

    // Add links array if needed
    if (!nginx.links) {
      nginx.links = [];
    }

    // Add backend link
    nginx.links.push(config.name + '-php:fpm');

    // Return the object
    return nginx;

  };

  /*
   * Build a starting point for our service
   * lets delegate this since php is complicated
   */
  var buildAppserver = function(config) {

    // Get name and type
    var name = config.name;
    var type = config.type;

    // Start a services collector
    var services = {};

    // Build the correct "appserver"
    services[name] = (type === 'nginx') ? nginx(config) : php(config);

    // Add fpm backend if we are doing nginx
    if (type === 'nginx') {
      var backend = [name, 'php'].join('-');
      services[backend] = php(config);
      delete services[backend].ports;
    }

    // Return things
    return services;

  };

  /**
   * Build out php
   */
  var builder = function(name, config) {

    // Parse our config
    config.name = name;
    config = parseConfig(config);

    // Get basic services things
    var services = buildAppserver(config);

    // Define config mappings
    var configFiles = {
      webroot: '/var/www/html',
      php: {
        conf: '/usr/local/etc/php/php.ini'
      },
      web: {
        server: config.serverConf
      }
    };

    // Handle custom web config files/dirs
    _.forEach(configFiles.web, function(file, type) {
      if (_.has(config, 'config.' + type)) {
        var local = config.config[type];
        var customConf = buildVolume(local, file, '$LANDO_APP_ROOT_BIND');
        services[name].volumes = addConfig(customConf, services[name].volumes);
      }
    });

    // Handle custom php config files/dirs
    _.forEach(configFiles.php, function(file, type) {
      if (_.has(config, 'config.' + type)) {
        var service = (config.type === 'nginx') ? name + '-php' : name;
        var local = config.config[type];
        var customConf = buildVolume(local, file, '$LANDO_APP_ROOT_BIND');
        var volumes = services[service].volumes;
        services[service].volumes = addConfig(customConf, volumes);
      }
    });

    // Add the datacontainer
    services.data = {
      image: 'busybox',
      volumes: [configFiles.webroot]
    };

    // Return our service
    return services;

  };

  return {
    builder: builder,
    versions: versions,
    configDir: __dirname
  };

};
