'use strict'
const assert = require('node:assert')
const { once } = require('node:events')
const { test } = require('node:test')
const { setTimeout: sleep } = require('node:timers/promises')
const { SubscriptionClient } = require('../lib/network')
const { gqlRequest, startRouter } = require('./helper')

test('simple subscription', async (t) => {
  const router = await startRouter(t, ['authors-subgraph'])

  t.after(() => {
    router.close()
  })

  await router.listen()
  const wsUrl = `ws://localhost:${router.server.address().port}/graphql`
  const client = new SubscriptionClient(wsUrl)

  t.after(async () => {
    await client.close()
  })

  await client.connect()
  await client.subscribe(`
    subscription {
      postPublished {
        authorId
      }
    }
  `)
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
