/**
 * Represents an error that has both a name and message.
 * @param {String} name - The name/type of the error.
 * @param {String} message - The corresponding message.
 */

var CustomError = function(name, message) {
  this.name = name;
  this.message = message;
};

/**
 * Creates custom errors to primarily help keep the program from crashing.
 */
module.exports = {
  CustomError: CustomError
};
