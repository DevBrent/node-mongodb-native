/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { expect } from 'chai';

import {
  AbstractCursor,
  Collection,
  CommandStartedEvent,
  Db,
  type Document,
  type GridFSFile,
  type MongoClient,
  type ObjectId,
  ReadConcern,
  ReadPreference,
  SERVER_DESCRIPTION_CHANGED,
  ServerType,
  type TopologyDescription,
  type TopologyType,
  WriteConcern
} from '../../mongodb';
import { getSymbolFrom, sleep } from '../../tools/utils';
import { type TestConfiguration } from '../runner/config';
import { EntitiesMap } from './entities';
import { expectErrorCheck, resultCheck } from './match';
import type { ExpectedEvent, OperationDescription } from './schema';
import { getMatchingEventCount, translateOptions } from './unified-utils';

interface OperationFunctionParams {
  client: MongoClient;
  operation: OperationDescription;
  entities: EntitiesMap;
  testConfig: TestConfiguration;
}

type RunOperationFn = (
  p: OperationFunctionParams
) => Promise<Document | boolean | number | null | void | string>;
export const operations = new Map<string, RunOperationFn>();

operations.set('createEntities', async ({ entities, operation, testConfig }) => {
  if (!operation.arguments?.entities) {
    throw new Error('encountered createEntities operation without entities argument');
  }
  await EntitiesMap.createEntities(testConfig, operation.arguments.entities!, entities);
});

operations.set('abortTransaction', async ({ entities, operation }) => {
  const session = entities.getEntity('session', operation.object);
  return session.abortTransaction();
});

operations.set('aggregate', async ({ entities, operation }) => {
  const dbOrCollection = entities.get(operation.object) as Db | Collection;
  if (!(dbOrCollection instanceof Db || dbOrCollection instanceof Collection)) {
    throw new Error(`Operation object '${operation.object}' must be a db or collection`);
  }
  const { pipeline, ...opts } = operation.arguments!;
  const cursor = dbOrCollection.aggregate(pipeline, opts);
  return cursor.toArray();
});

operations.set('assertCollectionExists', async ({ operation, client }) => {
  const collections = (
    await client
      .db(operation.arguments!.databaseName)
      .listCollections({}, { nameOnly: true })
      .toArray()
  ).map(({ name }) => name);
  expect(collections).to.include(operation.arguments!.collectionName);
});

operations.set('assertCollectionNotExists', async ({ operation, client }) => {
  const collections = (
    await client
      .db(operation.arguments!.databaseName)
      .listCollections({}, { nameOnly: true })
      .toArray()
  ).map(({ name }) => name);
  expect(collections).to.not.include(operation.arguments!.collectionName);
});

operations.set('assertIndexExists', async ({ operation, client }) => {
  const collection = client
    .db(operation.arguments!.databaseName)
    .collection(operation.arguments!.collectionName);
  const indexes = (await collection.listIndexes().toArray()).map(({ name }) => name);
  expect(indexes).to.include(operation.arguments!.indexName);
});

operations.set('assertIndexNotExists', async ({ operation, client }) => {
  const collection = client
    .db(operation.arguments!.databaseName)
    .collection(operation.arguments!.collectionName);

  const listIndexCursor = collection.listIndexes();
  let indexes;
  try {
    indexes = await listIndexCursor.toArray();
  } catch (error) {
    if (error.code === 26 || error.message.includes('ns does not exist')) {
      return;
    }
    // Error will always exist here, this makes the output show what caused an issue with assertIndexNotExists
    expect(error).to.not.exist;
  }
  expect(indexes.map(({ name }) => name)).to.not.include(operation.arguments!.indexName);
});

operations.set('assertDifferentLsidOnLastTwoCommands', async ({ entities, operation }) => {
  const client = entities.getEntity('client', operation.arguments!.client);
  expect(client.observedCommandEvents.includes('commandStarted')).to.be.true;

  const startedEvents = client.commandEvents.filter(
    ev => ev instanceof CommandStartedEvent
  ) as CommandStartedEvent[];

  expect(startedEvents).to.have.length.gte(2);

  const last = startedEvents[startedEvents.length - 1];
  const secondLast = startedEvents[startedEvents.length - 2];

  expect(last.command).to.have.property('lsid');
  expect(secondLast.command).to.have.property('lsid');

  expect(last.command.lsid.id.buffer.equals(secondLast.command.lsid.id.buffer)).to.be.false;
});

operations.set('assertSameLsidOnLastTwoCommands', async ({ entities, operation }) => {
  const client = entities.getEntity('client', operation.arguments!.client);
  expect(client.observedCommandEvents.includes('commandStarted')).to.be.true;

  const startedEvents = client.commandEvents.filter(
    ev => ev instanceof CommandStartedEvent
  ) as CommandStartedEvent[];

  expect(startedEvents).to.have.length.gte(2);

  const last = startedEvents[startedEvents.length - 1];
  const secondLast = startedEvents[startedEvents.length - 2];

  expect(last.command).to.have.property('lsid');
  expect(secondLast.command).to.have.property('lsid');

  expect(last.command.lsid.id.buffer.equals(secondLast.command.lsid.id.buffer)).to.be.true;
});

operations.set('assertSessionDirty', async ({ entities, operation }) => {
  const session = operation.arguments!.session;
  expect(session.serverSession.isDirty).to.be.true;
});

operations.set('assertSessionNotDirty', async ({ entities, operation }) => {
  const session = operation.arguments!.session;
  expect(session.serverSession.isDirty).to.be.false;
});

operations.set('assertSessionPinned', async ({ entities, operation }) => {
  const session = operation.arguments!.session;
  expect(session.isPinned, 'session should be pinned').to.be.true;
});

operations.set('assertSessionUnpinned', async ({ entities, operation }) => {
  const session = operation.arguments!.session;
  expect(session.isPinned, 'session should be unpinned').to.be.false;
});

operations.set('assertSessionTransactionState', async ({ entities, operation }) => {
  const session = operation.arguments!.session;

  const transactionStateTranslation = {
    none: 'NO_TRANSACTION',
    starting: 'STARTING_TRANSACTION',
    in_progress: 'TRANSACTION_IN_PROGRESS',
    committed: 'TRANSACTION_COMMITTED',
    aborted: 'TRANSACTION_ABORTED'
  };

  const driverTransactionStateName = transactionStateTranslation[operation.arguments!.state];
  expect(session.transaction.state).to.equal(driverTransactionStateName);
});

operations.set('assertNumberConnectionsCheckedOut', async ({ entities, operation }) => {
  const client = entities.getEntity('client', operation.arguments!.client);
  const servers = Array.from(client.topology!.s.servers.values());
  const checkedOutConnections = servers.reduce((count, server) => {
    const pool = server.pool;
    return count + pool.currentCheckedOutCount;
  }, 0);

  await Promise.resolve(); // wait one tick
  expect(checkedOutConnections).to.equal(operation.arguments!.connections);
});

operations.set('bulkWrite', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { requests, ...opts } = operation.arguments!;
  return collection.bulkWrite(requests, opts);
});

// The entity exists for the name but can potentially have the wrong
// type (stream/cursor) which will also throw an exception even when
// telling getEntity() to ignore checking existence.
operations.set('close', async ({ entities, operation }) => {
  /* eslint-disable no-empty */
  try {
    const cursor = entities.getEntity('cursor', operation.object);
    await cursor.close();
    return;
  } catch {}

  try {
    const changeStream = entities.getEntity('stream', operation.object);
    await changeStream.close();
    return;
  } catch {}

  try {
    const client = entities.getEntity('client', operation.object);
    await client.close();
    return;
  } catch {}
  /* eslint-enable no-empty */

  throw new Error(`No closable entity with key ${operation.object}`);
});

operations.set('commitTransaction', async ({ entities, operation }) => {
  const session = entities.getEntity('session', operation.object);
  return session.commitTransaction();
});

operations.set('createChangeStream', async ({ entities, operation }) => {
  const watchable = entities.get(operation.object);
  if (watchable == null || !('watch' in watchable)) {
    throw new Error(`Entity ${operation.object} must be watchable`);
  }

  const { pipeline, ...args } = operation.arguments!;
  const changeStream = watchable.watch(pipeline, args);

  return new Promise((resolve, reject) => {
    const init = getSymbolFrom(AbstractCursor.prototype, 'kInit');
    changeStream.cursor[init](err => {
      if (err) return reject(err);
      resolve(changeStream);
    });
  });
});

operations.set('createCollection', async ({ entities, operation }) => {
  const db = entities.getEntity('db', operation.object);
  const { collection, ...opts } = operation.arguments!;
  return await db.createCollection(collection, opts);
});

operations.set('createFindCursor', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, ...opts } = operation.arguments!;
  const cursor = collection.find(filter, opts);
  // The spec dictates that we create the cursor and force the find command
  // to execute, but don't move the cursor forward. hasNext() accomplishes
  // this.
  await cursor.hasNext();
  return cursor;
});

operations.set('createIndex', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { keys, ...opts } = operation.arguments!;
  await collection.createIndex(keys, opts);
});

operations.set('dropIndex', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { name, ...opts } = operation.arguments!;
  await collection.dropIndex(name, opts);
});

operations.set('deleteOne', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, ...options } = operation.arguments!;
  return collection.deleteOne(filter, options);
});

operations.set('dropCollection', async ({ entities, operation }) => {
  const db = entities.getEntity('db', operation.object);
  const { collection, ...opts } = operation.arguments!;

  // TODO(NODE-4243): dropCollection should suppress namespace not found errors
  try {
    return await db.dropCollection(collection, opts);
  } catch (err) {
    if (!/ns not found/.test(err.message)) {
      throw err;
    }
  }
});

operations.set('endSession', async ({ entities, operation }) => {
  const session = entities.getEntity('session', operation.object);
  return session.endSession();
});

operations.set('find', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, ...opts } = operation.arguments!;
  return collection.find(filter, opts).toArray();
});

operations.set('findOne', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, ...opts } = operation.arguments!;
  return collection.findOne(filter, opts);
});

operations.set('findOneAndReplace', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, replacement, ...opts } = operation.arguments!;
  return (await collection.findOneAndReplace(filter, replacement, translateOptions(opts))).value;
});

operations.set('findOneAndUpdate', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, update, ...opts } = operation.arguments!;
  return (await collection.findOneAndUpdate(filter, update, translateOptions(opts))).value;
});

operations.set('findOneAndDelete', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, ...opts } = operation.arguments!;
  return (await collection.findOneAndDelete(filter, opts)).value;
});

operations.set('failPoint', async ({ entities, operation }) => {
  const client = entities.getEntity('client', operation.arguments!.client);
  return entities.failPoints.enableFailPoint(client, operation.arguments!.failPoint);
});

operations.set('insertOne', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { document, ...opts } = operation.arguments!;
  return collection.insertOne(document, opts);
});

operations.set('insertMany', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { documents, ...opts } = operation.arguments!;
  return collection.insertMany(documents, opts);
});

operations.set('iterateUntilDocumentOrError', async ({ entities, operation }) => {
  const iterable = entities.getChangeStreamOrCursor(operation.object);
  return iterable.next();
});

operations.set('iterateOnce', async ({ entities, operation }) => {
  const iterable = entities.getChangeStreamOrCursor(operation.object);
  return iterable.tryNext();
});

operations.set('listCollections', async ({ entities, operation }) => {
  const db = entities.getEntity('db', operation.object);
  const { filter, ...opts } = operation.arguments!;
  return db.listCollections(filter, opts).toArray();
});

operations.set('listDatabases', async ({ entities, operation }) => {
  const client = entities.getEntity('client', operation.object);
  return client.db().admin().listDatabases(operation.arguments!);
});

operations.set('listIndexes', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  return collection.listIndexes(operation.arguments!).toArray();
});

operations.set('replaceOne', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, replacement, ...opts } = operation.arguments!;
  return collection.replaceOne(filter, replacement, opts);
});

operations.set('startTransaction', async ({ entities, operation }) => {
  const session = entities.getEntity('session', operation.object);
  session.startTransaction();
});

operations.set('targetedFailPoint', async ({ entities, operation }) => {
  const session = operation.arguments!.session;
  expect(session.isPinned, 'Session must be pinned for a targetedFailPoint').to.be.true;
  const address = session.transaction.isPinned
    ? session.transaction._pinnedServer.s.description.hostAddress
    : session.pinnedConnection.address;

  await entities.failPoints.enableFailPoint(address, operation.arguments!.failPoint);
});

operations.set('delete', async ({ entities, operation }) => {
  const bucket = entities.getEntity('bucket', operation.object);
  return bucket.delete(operation.arguments!.id);
});

operations.set('download', async ({ entities, operation }) => {
  const bucket = entities.getEntity('bucket', operation.object);

  const stream = bucket.openDownloadStream(operation.arguments!.id);
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', chunk => chunks.push(...chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(chunks));
  });
});

operations.set('upload', async ({ entities, operation }) => {
  const bucket = entities.getEntity('bucket', operation.object);

  const stream = bucket.openUploadStream(operation.arguments!.filename, {
    chunkSizeBytes: operation.arguments!.chunkSizeBytes
  });

  return new Promise<ObjectId>((resolve, reject) => {
    stream.end(Buffer.from(operation.arguments!.source.$$hexBytes, 'hex'), (error, file) => {
      if (error) reject(error);
      resolve((file as GridFSFile)._id as ObjectId);
    });
  });
});

operations.set('wait', async ({ operation }) => {
  expect(operation, 'Error in wait operation').to.have.nested.property('arguments.ms');
  expect(operation.arguments!.ms).to.be.a('number', 'Error in wait operation');
  await sleep(operation.arguments!.ms);
});

operations.set('waitForEvent', async ({ entities, operation }) => {
  expect(operation, 'Error in waitForEvent operation').to.have.property('arguments');
  const {
    client,
    event,
    count
  }: {
    client: string;
    event: ExpectedEvent;
    count: number;
  } = operation.arguments! as any;
  expect(count).to.be.a('number', 'Error in waitForEvent operation, invalid count');

  const mongoClient = entities.getEntity('client', client, true);

  const eventName = Object.keys(event)[0];
  const eventPromise = new Promise<void>(resolve => {
    function checkForEvent() {
      if (getMatchingEventCount(event, mongoClient, entities) >= count) {
        return resolve();
      }

      mongoClient.observedEventEmitter.once('observedEvent', checkForEvent);
    }
    checkForEvent();
  });
  await Promise.race([
    eventPromise,
    sleep(10000).then(() =>
      Promise.reject(
        new Error(
          `Timed out waiting for ${eventName}; captured [${mongoClient
            .getCapturedEvents('all')
            .map(e => e.constructor.name)
            .join(', ')}]`
        )
      )
    )
  ]);
});

operations.set('assertEventCount', async ({ entities, operation }) => {
  expect(operation, 'Error in assertEventCount operation').to.have.property('arguments');
  const {
    client,
    event,
    count
  }: {
    client: string;
    event: ExpectedEvent;
    count: number;
  } = operation.arguments! as any;
  expect(count).to.be.a('number', 'Error in assertEventCount operation, invalid count');

  const mongoClient = entities.getEntity('client', client, true);

  const eventName = Object.keys(event)[0];
  const actualEventCount = getMatchingEventCount(event, mongoClient, entities);
  expect(actualEventCount, `Error in assertEventCount for ${eventName}`).to.equal(count);
});

operations.set('recordTopologyDescription', async ({ entities, operation }) => {
  const { client, id }: { client: string; id: string } = operation.arguments! as any;
  expect(id).to.be.a('string');
  const mongoClient = entities.getEntity('client', client, true);
  const description = mongoClient.topology?.description;
  expect(description, `Undefined topology description for client ${client}`).to.exist;

  entities.set(id, description!);
});

operations.set('assertTopologyType', async ({ entities, operation }) => {
  const {
    topologyDescription,
    topologyType
  }: { topologyDescription: string; topologyType: TopologyType } = operation.arguments! as any;
  expect(topologyDescription).to.be.a('string');
  const actualDescription = entities.get(topologyDescription) as TopologyDescription;
  expect(actualDescription, `Failed to retrieve description for topology ${topologyDescription}`).to
    .exist;
  expect(actualDescription).to.have.property('type', topologyType);
});

operations.set('waitForPrimaryChange', async ({ entities, operation }) => {
  const {
    client,
    priorTopologyDescription,
    timeoutMS
  }: { client: string; priorTopologyDescription: TopologyType; timeoutMS?: number } =
    operation.arguments! as any;

  const mongoClient = entities.getEntity('client', client, true);

  expect(priorTopologyDescription).to.be.a('string');
  const priorTopologyDescriptionObject = entities.get(
    priorTopologyDescription
  ) as TopologyDescription;
  expect(
    priorTopologyDescriptionObject,
    `Failed to retrieve description for topology ${priorTopologyDescription}`
  ).to.exist;

  const priorPrimary = Array.from(priorTopologyDescriptionObject.servers.values()).find(
    serverDescription => serverDescription.type === ServerType.RSPrimary
  );

  const newPrimaryPromise = new Promise<void>(resolve => {
    function checkForNewPrimary() {
      const currentPrimary = Array.from(mongoClient.topology!.description.servers.values()).find(
        serverDescription => serverDescription.type === ServerType.RSPrimary
      );
      if (
        (!priorPrimary && currentPrimary) ||
        (currentPrimary && !currentPrimary.equals(priorPrimary))
      ) {
        return resolve();
      }

      mongoClient.once(SERVER_DESCRIPTION_CHANGED, checkForNewPrimary);
    }
    checkForNewPrimary();
  });
  await Promise.race([
    newPrimaryPromise,
    sleep(timeoutMS ?? 10000).then(() =>
      Promise.reject(new Error(`Timed out waiting for primary change on ${client}`))
    )
  ]);
});

operations.set('runOnThread', async ({ entities, operation, client, testConfig }) => {
  const threadId: string = operation.arguments!.thread;
  expect(threadId).to.be.a('string');
  const thread = entities.getEntity('thread', threadId, true);
  const operationToQueue = operation.arguments!.operation;
  const executeFn = () => executeOperationAndCheck(operationToQueue, entities, client, testConfig);
  thread.queue(executeFn);
});

operations.set('waitForThread', async ({ entities, operation }) => {
  const threadId: string = operation.arguments!.thread;
  expect(threadId).to.be.a('string');
  const thread = entities.getEntity('thread', threadId, true);
  await Promise.race([
    thread.finish(),
    sleep(10000).then(() => Promise.reject(new Error(`Timed out waiting for thread: ${threadId}`)))
  ]);
});

operations.set('withTransaction', async ({ entities, operation, client, testConfig }) => {
  const session = entities.getEntity('session', operation.object);

  const options = {
    readConcern: ReadConcern.fromOptions(operation.arguments),
    writeConcern: WriteConcern.fromOptions(operation.arguments),
    readPreference: ReadPreference.fromOptions(operation.arguments),
    maxCommitTimeMS: operation.arguments!.maxCommitTimeMS
  };

  let errorFromOperations = null;
  const result = await session.withTransaction(async () => {
    errorFromOperations = await (async () => {
      for (const callbackOperation of operation.arguments!.callback) {
        await executeOperationAndCheck(callbackOperation, entities, client, testConfig);
      }
    })().catch(error => error);
  }, options);

  if (result == null || errorFromOperations) {
    throw errorFromOperations ?? Error('transaction not committed');
  }
});

operations.set('countDocuments', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, ...opts } = operation.arguments!;
  return collection.countDocuments(filter, opts);
});

operations.set('deleteMany', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, ...opts } = operation.arguments!;
  return collection.deleteMany(filter, opts);
});

operations.set('distinct', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { fieldName, filter, ...opts } = operation.arguments!;
  return collection.distinct(fieldName, filter, opts);
});

operations.set('estimatedDocumentCount', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  return collection.estimatedDocumentCount(operation.arguments!);
});

operations.set('runCommand', async ({ entities, operation }: OperationFunctionParams) => {
  const db = entities.getEntity('db', operation.object);

  if (operation.arguments?.command == null) throw new Error('runCommand requires a command');
  const { command } = operation.arguments;

  if (operation.arguments.timeoutMS != null) throw new Error('timeoutMS not supported');

  const options = {
    readPreference: operation.arguments.readPreference,
    session: operation.arguments.session
  };

  return db.command(command, options);
});

operations.set('runCursorCommand', async ({ entities, operation }: OperationFunctionParams) => {
  const db = entities.getEntity('db', operation.object);
  const { command, ...opts } = operation.arguments!;
  const cursor = db.runCursorCommand(command, {
    readPreference: ReadPreference.fromOptions({ readPreference: opts.readPreference }),
    session: opts.session
  });

  if (!Number.isNaN(+opts.batchSize)) cursor.setBatchSize(+opts.batchSize);
  if (!Number.isNaN(+opts.maxTimeMS)) cursor.setMaxTimeMS(+opts.maxTimeMS);
  if (opts.comment !== undefined) cursor.setComment(opts.comment);

  return cursor.toArray();
});

operations.set('createCommandCursor', async ({ entities, operation }: OperationFunctionParams) => {
  const collection = entities.getEntity('db', operation.object);
  const { command, ...opts } = operation.arguments!;
  const cursor = collection.runCursorCommand(command, {
    readPreference: ReadPreference.fromOptions({ readPreference: opts.readPreference }),
    session: opts.session
  });

  if (!Number.isNaN(+opts.batchSize)) cursor.setBatchSize(+opts.batchSize);
  if (!Number.isNaN(+opts.maxTimeMS)) cursor.setMaxTimeMS(+opts.maxTimeMS);
  if (opts.comment !== undefined) cursor.setComment(opts.comment);

  // The spec dictates that we create the cursor and force the find command
  // to execute, but the first document must still be returned for the first iteration.
  await cursor.hasNext();

  return cursor;
});

operations.set('updateMany', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, update, ...options } = operation.arguments!;
  return collection.updateMany(filter, update, options);
});

operations.set('updateOne', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { filter, update, ...options } = operation.arguments!;
  return collection.updateOne(filter, update, options);
});

operations.set('rename', async ({ entities, operation }) => {
  const collection = entities.getEntity('collection', operation.object);
  const { to, ...options } = operation.arguments!;
  return collection.rename(to, options);
});

operations.set('createDataKey', async ({ entities, operation }) => {
  const clientEncryption = entities.getEntity('clientEncryption', operation.object);
  const { kmsProvider, opts } = operation.arguments!;

  return clientEncryption.createDataKey(kmsProvider, opts);
});

operations.set('rewrapManyDataKey', async ({ entities, operation }) => {
  const clientEncryption = entities.getEntity('clientEncryption', operation.object);
  const { filter, opts } = operation.arguments!;

  return await clientEncryption.rewrapManyDataKey(filter, opts);
});

operations.set('deleteKey', async ({ entities, operation }) => {
  const clientEncryption = entities.getEntity('clientEncryption', operation.object);
  const { id } = operation.arguments!;

  return clientEncryption.deleteKey(id);
});

operations.set('getKey', async ({ entities, operation }) => {
  const clientEncryption = entities.getEntity('clientEncryption', operation.object);
  const { id } = operation.arguments!;

  return clientEncryption.getKey(id);
});

operations.set('getKeys', async ({ entities, operation }) => {
  const clientEncryption = entities.getEntity('clientEncryption', operation.object);

  return clientEncryption.getKeys().toArray();
});

operations.set('addKeyAltName', async ({ entities, operation }) => {
  const clientEncryption = entities.getEntity('clientEncryption', operation.object);
  const { id, keyAltName } = operation.arguments!;

  return clientEncryption.addKeyAltName(id, keyAltName);
});

operations.set('removeKeyAltName', async ({ entities, operation }) => {
  const clientEncryption = entities.getEntity('clientEncryption', operation.object);
  const { id, keyAltName } = operation.arguments!;

  return clientEncryption.removeKeyAltName(id, keyAltName);
});

operations.set('getKeyByAltName', async ({ entities, operation }) => {
  const clientEncryption = entities.getEntity('clientEncryption', operation.object);
  const { keyAltName } = operation.arguments ?? {};

  return clientEncryption.getKeyByAltName(keyAltName);
});

operations.set('listSearchIndexes', async ({ entities, operation }) => {
  const collection: Collection<any> = entities.getEntity('collection', operation.object);
  const { name, aggregationOptions } = operation.arguments ?? {};
  return collection.listSearchIndexes(name, aggregationOptions).toArray();
});

operations.set('dropSearchIndex', async ({ entities, operation }) => {
  const collection: Collection<any> = entities.getEntity('collection', operation.object);
  const { name } = operation.arguments ?? {};
  return collection.dropSearchIndex(name);
});

operations.set('updateSearchIndex', async ({ entities, operation }) => {
  const collection: Collection<any> = entities.getEntity('collection', operation.object);
  const { name, definition } = operation.arguments ?? {};
  return collection.updateSearchIndex(name, definition);
});

operations.set('createSearchIndex', async ({ entities, operation }) => {
  const collection: Collection<any> = entities.getEntity('collection', operation.object);
  const { model } = operation.arguments ?? {};
  return collection.createSearchIndex(model);
});

operations.set('createSearchIndexes', async ({ entities, operation }) => {
  const collection: Collection<any> = entities.getEntity('collection', operation.object);
  const { models } = operation.arguments ?? {};
  return collection.createSearchIndexes(models);
});

export async function executeOperationAndCheck(
  operation: OperationDescription,
  entities: EntitiesMap,
  client: MongoClient,
  testConfig: TestConfiguration
): Promise<void> {
  const opFunc = operations.get(operation.name);
  expect(opFunc, `Unknown operation: ${operation.name}`).to.exist;

  if (operation.arguments?.session) {
    operation.arguments.session = entities.getEntity('session', operation.arguments.session);
  }

  let result;

  try {
    result = await opFunc!({ entities, operation, client, testConfig });
  } catch (error) {
    if (operation.expectError) {
      expectErrorCheck(error, operation.expectError, entities);
      return;
    } else if (!operation.ignoreResultAndError) {
      throw error;
    }
  }

  // We check the positive outcome here so the try-catch above doesn't catch our chai assertions
  if (operation.ignoreResultAndError) {
    return;
  }

  if (operation.expectError) {
    expect.fail(`Operation ${operation.name} succeeded but was not supposed to`);
  }

  if (operation.expectResult) {
    resultCheck(result, operation.expectResult as any, entities);
  }

  if (operation.saveResultAsEntity) {
    entities.set(operation.saveResultAsEntity, result);
  }
}
