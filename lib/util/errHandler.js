/** Utility function for seeing if an error is fatal (crashes the program).
 * @param {Object} err - The error in question.
 * @return {Boolean} - If the error is fatal or not.
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
 * @param {Object} err - Error from application.
 */
var errHandler = function(err) {
  if (!isFatal(err)) {
   console.log(err.message);
  } else {
   throw err;
  }
};

/**
 * Decides how to handle an error, then responds accordingly.
 */
module.exports = errHandler;
