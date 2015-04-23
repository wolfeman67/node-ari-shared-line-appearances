/**
 * Utility function for checking whether or not a call is in progress
 * @param {String} currentState - the current state of the SLA extension
 * @param {String} states - the list of states that can be compared
 * @return {boolean} - whether or not the extension has a call in progress
 */
function callInProgress(currentState, states) {
  if (currentState === states.INUSE || currentState === states.BUSY ||
      currentState === states.RINGING) {
        return true;
      } else {
        return false;
      }
}
module.exports = callInProgress;