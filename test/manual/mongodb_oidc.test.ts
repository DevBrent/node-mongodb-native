import { readFile } from 'node:fs/promises';

import { expect } from 'chai';

import { MongoClient, OIDC_WORKFLOWS } from '../mongodb';

describe('MONGODB-OIDC', function () {
  context('when running in the environment', function () {
    it('contains AWS_WEB_IDENTITY_TOKEN_FILE', function () {
      expect(process.env).to.have.property('AWS_WEB_IDENTITY_TOKEN_FILE');
    });
  });

  describe('OIDC Auth Spec Prose Tests', function () {
    // Drivers MUST be able to authenticate using OIDC callback(s) when there
    // is one principal configured.
    describe('1. Callback-Driven Auth', function () {
      // - Create a request callback that reads in the generated ``test_user1`` token file.
      const requestCallback = async () => {
        const token = await readFile(`${process.env.OIDC_TOKEN_DIR}/test_user1`, {
          encoding: 'utf8'
        });
        return { accessToken: token };
      };

      context('when no username is provided', function () {
        let client;
        let collection;
        // - Create a client with a url of the form  ``mongodb://localhost/?authMechanism=MONGODB-OIDC``
        //   and the OIDC request callback.
        before(function () {
          client = new MongoClient('mongodb://localhost/?authMechanism=MONGODB-OIDC', {
            authMechanismProperties: {
              REQUEST_TOKEN_CALLBACK: requestCallback
            }
          });
          collection = client.db('test').collection('test');
        });

        after(async () => {
          await client?.close();
        });

        // - Perform a ``find`` operation.
        // - Clear the cache.
        it('successfully authenticates', async function () {
          const doc = await collection.findOne();
          expect(doc).to.equal(null);
        });
      });

      context('when a username is provided', function () {
        let client;
        let collection;
        // - Create a client with a url of the form
        //   ``mongodb://test_user1@localhost/?authMechanism=MONGODB-OIDC`` and the OIDC request callback.
        before(function () {
          client = new MongoClient('mongodb://test_user1@localhost/?authMechanism=MONGODB-OIDC', {
            authMechanismProperties: {
              REQUEST_TOKEN_CALLBACK: requestCallback
            }
          });
          collection = client.db('test').collection('test');
        });

        after(async () => {
          await client?.close();
        });

        // - Perform a ``find`` operation.
        // - Clear the cache.
        it('successfully authenticates', async function () {
          const doc = await collection.findOne();
          expect(doc).to.equal(null);
        });
      });
    });

    // Drivers MUST be able to authenticate using the "aws" device workflow simulating
    // an EC2 instance with an enabled web identity token provider, generated by
    // Drivers Evergreen Tools.
    describe('2. AWS Device Auth', function () {
      const testTokenFile = process.env.AWS_WEB_IDENTITY_TOKEN_FILE;
      let client;
      let collection;
      after(() => {
        process.env.AWS_WEB_IDENTITY_TOKEN_FILE = testTokenFile;
        client?.close();
      });

      // - Create a client with the url parameters
      //   ``?authMechanism=MONGODB-OIDC&authMechanismProperties=DEVICE_NAME=aws``.
      before(function () {
        // Set the ``AWS_WEB_IDENTITY_TOKEN_FILE`` environment variable to the location
        // of the ``test_user1`` generated token file.
        process.env.AWS_WEB_IDENTITY_TOKEN_FILE = `${process.env.OIDC_TOKEN_DIR}/test_user1`;
        client = new MongoClient(
          'mongodb://localhost/?authMechanism=MONGODB-OIDC&authMechanismProperties=DEVICE_NAME:aws'
        );
        collection = client.db('test').collection('test');
      });

      // - Perform a find operation on the client.
      it('successfully authenticates', async function () {
        const doc = await collection.findOne();
        expect(doc).to.equal(null);
      });
    });

    // Drivers MUST be able to authenticate using either authentication or device
    // type if there are multiple principals configured on the server.  Note that
    // ``directConnection=true`` and ``readPreference=secondaryPreferred`` are needed
    // because the server is a secondary on a replica set, on port ``27018``.
    describe('3. Multiple Principals', function () {
      context('when authenticating with user 1', function () {
        context('when using a callback', function () {
          let client;
          let collection;
          // - Create a request callback that reads in the generated ``test_user1`` token file.
          const requestCallback = async () => {
            const token = await readFile(`${process.env.OIDC_TOKEN_DIR}/test_user1`, {
              encoding: 'utf8'
            });
            return { accessToken: token };
          };
          // - Create a client with a url of the form
          // ``mongodb://test_user1@localhost:27018/?authMechanism=MONGODB-OIDC&directConnection=true&readPreference=secondaryPreferred``
          // and the OIDC request callback.
          before(function () {
            client = new MongoClient(
              'mongodb://test_user1@localhost:27018/?authMechanism=MONGODB-OIDC&directConnection=true&readPreference=secondaryPreferred',
              {
                authMechanismProperties: {
                  REQUEST_TOKEN_CALLBACK: requestCallback
                }
              }
            );
            collection = client.db('test').collection('test');
          });

          after(async () => {
            client?.close();
          });

          // - Perform a ``find`` operation.
          // - Clear the cache.
          it('successfully authenticates', async function () {
            const doc = await collection.findOne();
            expect(doc).to.equal(null);
          });
        });

        context('when using aws', function () {
          const testTokenFile = process.env.AWS_WEB_IDENTITY_TOKEN_FILE;
          let client;
          let collection;

          after(async () => {
            process.env.AWS_WEB_IDENTITY_TOKEN_FILE = testTokenFile;
            client?.close();
          });

          before(async () => {
            // - Set the ``AWS_WEB_IDENTITY_TOKEN_FILE`` environment variable to the location
            // of the ``test_user1`` generated token file.
            process.env.AWS_WEB_IDENTITY_TOKEN_FILE = `${process.env.OIDC_TOKEN_DIR}/test_user1`;
            // - Create a client with a url of the form
            // ``mongodb://localhost:27018/?authMechanism=MONGODB-OIDC&authMechanismProperties=DEVICE_NAME:aws&directConnection=true&readPreference=secondaryPreferred``.
            client = new MongoClient(
              'mongodb://localhost:27018/?authMechanism=MONGODB-OIDC&authMechanismProperties=DEVICE_NAME:aws&directConnection=true&readPreference=secondaryPreferred'
            );
            collection = client.db('test').collection('test');
          });

          // - Perform a ``find`` operation.
          it('successfully authenticates', async function () {
            const doc = await collection.findOne();
            expect(doc).to.equal(null);
          });
        });
      });

      context('when authenticating with user 2', function () {
        context('when using a callback', function () {
          let client;
          let collection;
          // - Create a request callback that reads in the generated ``test_user2`` token file.
          const requestCallback = async () => {
            const token = await readFile(`${process.env.OIDC_TOKEN_DIR}/test_user2`, {
              encoding: 'utf8'
            });
            return { accessToken: token };
          };
          // - Create a client with a url of the form
          // ``mongodb://test_user2@localhost:27018/?authMechanism=MONGODB-OIDC&directConnection=true&readPreference=secondaryPreferred``
          // and the OIDC request callback.
          before(function () {
            client = new MongoClient(
              'mongodb://test_user2@localhost:27018/?authMechanism=MONGODB-OIDC&directConnection=true&readPreference=secondaryPreferred',
              {
                authMechanismProperties: {
                  REQUEST_TOKEN_CALLBACK: requestCallback
                }
              }
            );
            collection = client.db('test').collection('test');
          });

          after(async () => {
            client?.close();
          });

          // - Perform a ``find`` operation.
          // - Clear the cache.
          it('successfully authenticates', async function () {
            const doc = await collection.findOne();
            expect(doc).to.equal(null);
          });
        });

        context('when using aws', function () {
          let client;
          let collection;
          const testTokenFile = process.env.AWS_WEB_IDENTITY_TOKEN_FILE;

          after(async () => {
            process.env.AWS_WEB_IDENTITY_TOKEN_FILE = testTokenFile;
            client?.close();
          });

          before(async () => {
            // - Set the ``AWS_WEB_IDENTITY_TOKEN_FILE`` environment variable to the location
            // of the ``test_user2`` generated token file.
            process.env.AWS_WEB_IDENTITY_TOKEN_FILE = `${process.env.OIDC_TOKEN_DIR}/test_user2`;
            // - Create a client with a url of the form
            // ``mongodb://localhost:27018/?authMechanism=MONGODB-OIDC&authMechanismProperties=DEVICE_NAME:aws&directConnection=true&readPreference=secondaryPreferred``.
            client = new MongoClient(
              'mongodb://localhost:27018/?authMechanism=MONGODB-OIDC&authMechanismProperties=DEVICE_NAME:aws&directConnection=true&readPreference=secondaryPreferred'
            );
            collection = client.db('test').collection('test');
          });

          // - Perform a ``find`` operation.
          it('successfully authenticates', async function () {
            const doc = await collection.findOne();
            expect(doc).to.equal(null);
          });
        });
      });

      context('when not providing a user', function () {
        it('fails on option parsing', async function () {
          expect(async () => {
            new MongoClient(
              'mongodb://localhost:27018/?authMechanism=MONGODB-OIDC&directConnection=true&readPreference=secondaryPreferred'
            );
          }).to.throw();
        });
      });
    });

    describe('4. Invalid Callbacks', function () {
      // - Any callback returns null
      context('when the callback returns null', function () {
        let client;
        const requestCallback = async () => {
          return null;
        };

        before(function () {
          client = new MongoClient('mongodb://localhost/?authMechanism=MONGODB-OIDC', {
            authMechanismProperties: {
              REQUEST_TOKEN_CALLBACK: requestCallback
            }
          });
        });

        after(async () => {
          client?.close();
        });

        it('raises an error', async function () {
          expect(async () => {
            await client.connect();
          }).to.throw();
        });
      });

      // - Any callback returns unexpected result
      context('then the callback returns an unexpected result', function () {
        let client;
        const requestCallback = async () => {
          return { unexpected: 'test' };
        };

        before(function () {
          client = new MongoClient('mongodb://localhost/?authMechanism=MONGODB-OIDC', {
            authMechanismProperties: {
              REQUEST_TOKEN_CALLBACK: requestCallback
            }
          });
        });

        after(async () => {
          client?.close();
        });

        it('raises an error', async function () {
          expect(async () => {
            await client.connect();
          }).to.throw();
        });
      });
    });

    // Drivers MUST ensure that they are testing the ability to cache credentials.
    // Drivers will need to be able to query and override the cached credentials to
    // verify usage.  Unless otherwise specified, the tests MUST be performed with
    // the authorization code workflow with and without a provided refresh callback.
    // If desired, the caching tests can be done using mock server responses.
    describe('5. Caching', function () {
      let requestInvokations = 0;
      let refreshInvokations = 0;
      const cache = OIDC_WORKFLOWS.callback.cache;
      // - Give a callback response with a valid accessToken and an expiresInSeconds
      //   that is within one minute.
      // - Validate the request callback inputs, including the timeout parameter if possible.
      const requestCallback = async (principalName, serverResult, timeout) => {
        const token = await readFile(`${process.env.OIDC_TOKEN_DIR}/test_user1`, {
          encoding: 'utf8'
        });

        expect(principalName).to.equal('test_user1');
        expect(serverResult).to.have.property('clientId');
        expect(timeout).to.equal(300000);
        requestInvokations++;

        return { accessToken: token, expiresInSeconds: 30 };
      };

      const refreshCallback = async (principalName, serverResult, tokenResult, timeout) => {
        const token = await readFile(`${process.env.OIDC_TOKEN_DIR}/test_user1`, {
          encoding: 'utf8'
        });

        expect(principalName).to.equal('test_user1');
        expect(serverResult).to.have.property('clientId');
        expect(tokenResult.accessToken).to.equal(token);
        expect(timeout).to.equal(300000);
        refreshInvokations++;

        return { accessToken: token, expiresInSeconds: 30 };
      };

      beforeEach(() => {
        requestInvokations = 0;
        refreshInvokations = 0;
      });

      context('when calling the request callback', function () {
        let client;
        let collection;

        // - Clear the cache.
        before(function () {
          cache.clear();

          // - Create a new client with a request callback and a refresh callback.
          //   Both callbacks will read the contents of the AWS_WEB_IDENTITY_TOKEN_FILE
          //   location to obtain a valid access token.
          client = new MongoClient('mongodb://test_user1@localhost/?authMechanism=MONGODB-OIDC', {
            authMechanismProperties: {
              REQUEST_TOKEN_CALLBACK: requestCallback,
              REFRESH_TOKEN_CALLBACK: refreshCallback
            }
          });
          collection = client.db('test').collection('test');
        });

        after(async () => {
          client?.close();
        });

        // - Ensure that a find operation adds credentials to the cache.
        it('adds credentials to the cache', async function () {
          await collection.findOne();
          expect(cache.entries.size).to.equal(1);
        });
      });

      context('when calling the refresh callback', function () {
        let client;
        let collection;

        before(function () {
          // - Create a new client with the same request callback and a refresh callback.
          client = new MongoClient('mongodb://test_user1@localhost/?authMechanism=MONGODB-OIDC', {
            authMechanismProperties: {
              REQUEST_TOKEN_CALLBACK: requestCallback,
              REFRESH_TOKEN_CALLBACK: refreshCallback
            }
          });
          collection = client.db('test').collection('test');
        });

        after(async () => {
          client?.close();
        });

        // - Ensure that a find operation results in a call to the refresh callback.
        // - Validate the refresh callback inputs, including the timeout parameter if possible.
        // - Ensure there is a cache with credentials that will expire in less than 5 minutes,
        //   using a client with an appropriate request callback.
        it('adds credentials to the cache', async function () {
          await collection.findOne();
          expect(requestInvokations).to.equal(0);
          expect(refreshInvokations).to.equal(1);
          expect(cache.entries.values().next().value.expiration).to.be.below(Date.now() + 300000);
        });
      });

      context('when providing no refresh callback', function () {
        let client;
        let collection;

        before(function () {
          // - Create a new client with the a request callback but no refresh callback.
          client = new MongoClient('mongodb://test_user1@localhost/?authMechanism=MONGODB-OIDC', {
            authMechanismProperties: {
              REQUEST_TOKEN_CALLBACK: requestCallback
            }
          });
          collection = client.db('test').collection('test');
        });

        after(async () => {
          client?.close();
          cache.clear();
        });

        // - Ensure that a find operation results in a call to the request callback.
        it('adds credentials to the cache', async function () {
          await collection.findOne();
          expect(requestInvokations).to.equal(1);
          expect(refreshInvokations).to.equal(0);
        });
      });
    });
  });
});
