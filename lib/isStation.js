var regexp = require('node-regexp');

/**
 * Utility function for checking if a channel is a member of an extension
 * @param {String} extension - the extension in question
 * @param {String} channel - the channel in question
 * @return {Q} - Q promise object
 */
function isStation (extension, channel) {
  var stations = extension.stations;
  var isItStation = false;
  for (var index = 0; index < stations.length; index++) {
    var station = stations[index];
    var re = regexp().find(station).toRegExp();

    // First conditional is for regular SIP users like SIP/phone1
    if (re.test(channel.name)) {
      isItStation = true;
      break;
    } else {

      // Second conditional is for other SIP users that have a different
      // server like SIP/phone2@1234
      var nameDivided = channel.name.split('/');
      if (re.test(nameDivided[0] + '/' + channel.caller.number + '@' +
          nameDivided[1])) {
            isItStation = true;
            break;
          }
    }
  }
  return isItStation;
}

module.exports = isStation;