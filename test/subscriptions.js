'use strict'
const assert = require('node:assert')
const { once } = require('node:events')
const { test } = require('node:test')
const { setTimeout: sleep } = require('node:timers/promises')
const { SubscriptionClient } = require('@mercuriusjs/subscription-client')
const { graphqlRequest, startRouter } = require('./helper')

test('simple subscription', async (t) => {
  const router = await startRouter(t, ['authors-subgraph'])

  t.after(() => {
    router.close()
  })

  await router.listen()
  const wsUrl = `ws://localhost:${router.server.address().port}/graphql`
  const client = new SubscriptionClient(wsUrl, { serviceName: 'test' })

  t.after(() => {
    try {
      client.unsubscribeAll()
      client.close()
    } catch {} // Ignore any errors. The client should already be closed.
  })

  client.connect()
  await once(client, 'ready')
  client.createSubscription(`
    subscription {
      postPublished {
        authorId
      }
    }
  `, {}, (data) => {
    client.emit('message', data.payload)
  })
  await sleep(200) // Make sure the subscription has finished setting up.
  const mutation = await graphqlRequest(router, `
    mutation {
      publishBlogPost(authorId: "2299")
    }
  `)
  assert.deepStrictEqual(mutation, { publishBlogPost: true })
  const [message] = await once(client, 'message')
  assert.deepStrictEqual(message, { postPublished: { authorId: '2299' } })

  const mutation2 = await graphqlRequest(router, `
    mutation {
      publishBlogPost(authorId: "3333")
    }
  `)
  assert.deepStrictEqual(mutation2, { publishBlogPost: true })
  const [message2] = await once(client, 'message')
  assert.deepStrictEqual(message2, { postPublished: { authorId: '3333' } })

  client.unsubscribeAll()
  client.close()
  await sleep(200) // Make sure the subscription has finished tearing down.

  const mutation3 = await graphqlRequest(router, `
    mutation {
      publishBlogPost(authorId: "4444")
    }
  `)
  assert.deepStrictEqual(mutation3, { publishBlogPost: true })
  assert.deepStrictEqual(router._subscriptionRecorder, [
    { action: 'subscribe', topic: '1' },
    {
      action: 'publish',
      topic: '1',
      payload: { postPublished: { authorId: '2299' } }
    },
    {
      action: 'publish',
      topic: '1',
      payload: { postPublished: { authorId: '3333' } }
    },
    { action: 'unsubscribe', topic: '1' }
  ])
})

test('subscription with followup queries', async (t) => {
  const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph'])

  t.after(() => {
    router.close()
  })

  await router.listen()
  const wsUrl = `ws://localhost:${router.server.address().port}/graphql`
  const client = new SubscriptionClient(wsUrl, { serviceName: 'test' })

  t.after(() => {
    try {
      client.unsubscribeAll()
      client.close()
    } catch {} // Ignore any errors. The client should already be closed.
  })

  client.connect()
  await once(client, 'ready')
  client.createSubscription(`
    subscription {
      reviewPosted {
        id rating content book { id title genre reviews { id rating content } }
      }
    }
  `, {}, (data) => {
    client.emit('message', data.payload)
  })
  await sleep(200) // Make sure the subscription has finished setting up.
  const mutation = await graphqlRequest(router, `
    mutation {
      createReview(review: { bookId: "1", rating: 10, content: "Not sure" }) {
        id rating content
      }
    }
  `)
  assert.deepStrictEqual(mutation, {
    createReview: {
      id: '2',
      rating: 10,
      content: 'Not sure'
    }
  })
  const [message] = await once(client, 'message')
  assert.deepStrictEqual(message, {
    reviewPosted: {
      id: '2',
      rating: 10,
      content: 'Not sure',
      book: {
        id: '1',
        genre: 'FICTION',
        title: 'A Book About Things That Never Happened',
        reviews: [
          {
            id: '1',
            rating: 2,
            content: 'Would not read again.'
          },
          {
            id: '2',
            rating: 10,
            content: 'Not sure'
          }
        ]
      }
    }
  })
})

test('subscription errors are propagated', async (t) => {
  const overrides = {
    subscriptions: {
      onError (ctx, topic, error) {
        client.emit('subscriptionError', error)
      },
      publish (ctx, topic, payload) {
        throw new Error('boom')
      }
    }
  }
  const subgraphs = ['books-subgraph', 'reviews-subgraph']
  const router = await startRouter(t, subgraphs, overrides)

  t.after(() => {
    router.close()
  })

  await router.listen()
  const wsUrl = `ws://localhost:${router.server.address().port}/graphql`
  const client = new SubscriptionClient(wsUrl, { serviceName: 'test' })

  t.after(() => {
    try {
      client.unsubscribeAll()
      client.close()
    } catch {} // Ignore any errors. The client should already be closed.
  })

  client.connect()
  await once(client, 'ready')
  client.createSubscription(`
    subscription {
      reviewPosted {
        id rating content book { id title genre reviews { id rating content } }
      }
    }
  `, {}, (data) => {
    client.emit('message', data.payload)
  })
  await sleep(200) // Make sure the subscription has finished setting up.
  const mutation = await gqlRequest(router, `
    mutation {
      createReview(review: { bookId: "1", rating: 10, content: "Not sure" }) {
        id rating content
      }
    }
  `)
  assert.deepStrictEqual(mutation, {
    createReview: {
      id: '2',
      rating: 10,
      content: 'Not sure'
    }
  })
  const [error] = await once(client, 'subscriptionError')
  assert.strictEqual(error.message, 'boom')
})
