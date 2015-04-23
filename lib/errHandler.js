/** Utility function for seeing if an error is fatal (crashes the program)
 * @param {Object} err - the error in question.
 * @return {boolean} - if the error is fatal or not
 */
function isFatal(err) {
  return !(err.name === 'DialedHungup' || err.name === 'HangupFailure' ||
      err.name === 'NoStations' || err.name === 'InboundHungup' ||
      err.name === 'ExtensionBusy' || err.name === 'OutboundHungup' ||
      err.name === 'StationsHungup' || err.name === 'EarlyOutboundHungup' ||
      err.name === 'ExtensionOccupied');
}

/**
 * Handles errors found in application.
 * @param {Object} err - error from application.
 */
var errHandler = function(err) {
  if (!isFatal(err)) {
   console.log(err.message);
  } else {
   throw err;
  }
}

module.exports = errHandler;
