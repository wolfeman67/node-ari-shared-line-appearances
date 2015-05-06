var regexp = require('node-regexp');

/**
 * Utility function for checking if a channel is a member of an extension
 * @param {String} extensionName - the name of the extension to check
 * @param {String} channel - the channel in question
 * @return {Q} - Q promise object
 */
var isStation = function(extension, channel) {
  var stations = extension.stations;
  var isStation = false;
  for (var index = 0; index < stations.length; index++) {
    var station = stations[index];
    var re = regexp().find(station).toRegExp();

    // First conditional is for regular SIP users like SIP/phone1
    if (re.test(channel.name)) {
      isStation = true;
      break;
    } else {

      // Second conditional is for other SIP users that have a different
      // server like SIP/phone2@1234
      var nameDivided = channel.name.split('/');
      if (re.test(nameDivided[0] + '/' + channel.caller.number + '@' +
          nameDivided[1])) {
            isStation = true;
            break;
          }
    }
  }
  return isStation;
};

module.exports = isStation;