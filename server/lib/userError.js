function userError(message, statusCode = 400) {
  const err = new Error(message);
  err.isUserError = true;
  err.statusCode = statusCode;
  return err;
}

function isUserError(err) {
  return Boolean(err && err.isUserError);
}

module.exports = { userError, isUserError };