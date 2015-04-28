/**
 * Represents an error that has both a name and message.
 * @param {String} name - the name/type of the error
 * @param {String} message - the corresponding message
 * Mainly used to avoid crashing the program, as it does with regular errors.
 */

var CustomError = function(name, message) {
  this.name = name;
  this.message = message;
};


module.exports = {
  CustomError: CustomError
};
