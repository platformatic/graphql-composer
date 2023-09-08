'use strict'
const assert = require('node:assert')
const { once } = require('node:events')
const { test } = require('node:test')
const { setTimeout: sleep } = require('node:timers/promises')
const { SubscriptionClient } = require('@mercuriusjs/subscription-client')
const { gqlRequest, startRouter } = require('./helper')

test('simple subscription', async (t) => {
  const router = await startRouter(t, ['authors-subgraph'])

  t.after(() => {
    router.close()
  })

  await router.listen()
  const wsUrl = `ws://localhost:${router.server.address().port}/graphql`
  const client = new SubscriptionClient(wsUrl, { serviceName: 'test' })

  t.after(() => {
    client.unsubscribeAll()
    client.close()
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
  const mutation = await gqlRequest(router, `
    mutation {
      publishBlogPost(authorId: "2299")
    }
  `)
  assert.deepStrictEqual(mutation, { publishBlogPost: true })
  const [message] = await once(client, 'message')
  assert.deepStrictEqual(message, { postPublished: { authorId: '2299' } })
})
