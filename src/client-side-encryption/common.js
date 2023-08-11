/* eslint-disable */

export function maybeCallback(promiseFn, callback) {
  const promise = promiseFn();
  if (callback == null) {
    return promise;
  }

  promise.then(
    result => process.nextTick(callback, undefined, result),
    error => process.nextTick(callback, error)
  );
  return;
}

/**
 * @ignore
 * A helper function. Invokes a function that takes a callback as the final
 * parameter. If a callback is supplied, then it is passed to the function.
 * If not, a Promise is returned that resolves/rejects with the result of the
 * callback
 * @param {Function} [callback] an optional callback.
 * @param {Function} fn A function that takes a callback
 * @returns {Promise|void} Returns nothing if a callback is supplied, else returns a Promise.
 */
export function promiseOrCallback(callback, fn) {
  if (typeof callback === 'function') {
    fn(function (err) {
      if (err != null) {
        try {
          callback(err);
        } catch (error) {
          return process.nextTick(() => {
            throw error;
          });
        }
        return;
      }

      callback.apply(this, arguments);
    });

    return;
  }

  return new Promise((resolve, reject) => {
    fn(function (err, res) {
      if (err != null) {
        return reject(err);
      }

      if (arguments.length > 2) {
        return resolve(Array.prototype.slice.call(arguments, 1));
      }

      resolve(res);
    });
  });
}
