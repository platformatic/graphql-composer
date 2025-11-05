'use strict'

const assert = require('node:assert')
const { test } = require('node:test')
const path = require('node:path')

const {
  createComposerService,
  createGraphqlServices,
  graphqlRequest
} = require('./helper')
const { compose } = require('../lib')

test('should escape quotes with JSON.stringify', async (t) => {
  const testCases = [
    {
      name: 'should escape quotes in literal string arguments',
      query: 'mutation { createAuthor(author: { firstName: "John\\"Quote", lastName: "Doe" }) { id name { firstName lastName } } }',
      expectedFirstName: 'John"Quote'
    },
    {
      name: 'should escape quotes in string variables',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: 'John"Quote', lastName: 'Doe' } },
      expectedFirstName: 'John"Quote'
    },
    {
      name: 'should escape multiple quotes in string variables',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: 'John"Test"Quote', lastName: 'Doe' } },
      expectedFirstName: 'John"Test"Quote'
    },
    {
      name: 'should handle strings with whitespace and quotes',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: '  " ', lastName: 'Doe' } },
      expectedFirstName: '  " '
    },
    {
      name: 'should handle very long strings with quotes',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: 'A'.repeat(500) + '"test"' + 'A'.repeat(500), lastName: 'Doe' } },
      expectedFirstName: 'A'.repeat(500) + '"test"' + 'A'.repeat(500)
    },
    {
      name: 'should handle unicode and quotes in string variables',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: 'John\u2764"Unicode', lastName: 'Doe' } },
      expectedFirstName: 'John❤"Unicode'
    }
  ]

  let service, services
  t.before(async () => {
    services = await createGraphqlServices(t, [
      {
        name: 'authors-subgraph',
        file: path.join(__dirname, 'fixtures/authors.js'),
        listen: true
      }
    ])
    const options = {
      subgraphs: services.map((service) => ({
        name: service.name,
        server: { host: service.host }
      }))
    }

    const s = await createComposerService(t, { compose, options })
    service = s.service
  })

  t.beforeEach(() => {
    services.forEach((s) => s.config.reset())
  })

  for (const tc of testCases) {
    await t.test(tc.name, async (t) => {
      const result = await graphqlRequest(service, tc.query, tc.variables)
      assert.strictEqual(result.createAuthor.name.firstName, tc.expectedFirstName)
    })
  }
})

test('should escape backslashes and newlines with JSON.stringify', async (t) => {
  const testCases = [
    {
      name: 'should escape backslashes in literal string arguments',
      query: 'mutation { createAuthor(author: { firstName: "John\\\\Backslash", lastName: "Doe" }) { id name { firstName lastName } } }',
      expectedFirstName: 'John\\Backslash'
    },
    {
      name: 'should escape newlines in literal string arguments',
      query: 'mutation { createAuthor(author: { firstName: "John\\nNewline", lastName: "Doe" }) { id name { firstName lastName } } }',
      expectedFirstName: 'John\nNewline'
    },
    {
      name: 'should escape tabs in literal string arguments',
      query: 'mutation { createAuthor(author: { firstName: "John\\tTab", lastName: "Doe" }) { id name { firstName lastName } } }',
      expectedFirstName: 'John\tTab'
    },
    {
      name: 'should escape carriage returns in literal string arguments',
      query: 'mutation { createAuthor(author: { firstName: "John\\rCarriageReturn", lastName: "Doe" }) { id name { firstName lastName } } }',
      expectedFirstName: 'John\rCarriageReturn'
    },
    {
      name: 'should escape backslashes in string variables',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: 'John\\Backslash', lastName: 'Doe' } },
      expectedFirstName: 'John\\Backslash'
    },
    {
      name: 'should escape newlines in string variables',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: 'John\nNewline', lastName: 'Doe' } },
      expectedFirstName: 'John\nNewline'
    },
    {
      name: 'should escape tabs in string variables',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: 'John\tTab', lastName: 'Doe' } },
      expectedFirstName: 'John\tTab'
    },
    {
      name: 'should handle unicode in string variables',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: 'John\u2764Unicode', lastName: 'Doe' } },
      expectedFirstName: 'John❤Unicode'
    }
  ]

  let service, services
  t.before(async () => {
    services = await createGraphqlServices(t, [
      {
        name: 'authors-subgraph',
        file: path.join(__dirname, 'fixtures/authors.js'),
        listen: true
      }
    ])
    const options = {
      subgraphs: services.map((service) => ({
        name: service.name,
        server: { host: service.host }
      }))
    }

    const s = await createComposerService(t, { compose, options })
    service = s.service
  })

  t.beforeEach(() => {
    services.forEach((s) => s.config.reset())
  })

  for (const tc of testCases) {
    await t.test(tc.name, async (t) => {
      const result = await graphqlRequest(service, tc.query, tc.variables)
      assert.strictEqual(result.createAuthor.name.firstName, tc.expectedFirstName)
    })
  }
})

test('should handle edge cases with JSON.stringify', async (t) => {
  const testCases = [
    {
      name: 'should handle empty strings',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: '', lastName: 'Doe' } },
      expectedFirstName: ''
    },
    {
      name: 'should handle strings with only whitespace',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: '   ', lastName: 'Doe' } },
      expectedFirstName: '   '
    },
    {
      name: 'should handle strings with control characters',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: 'John\u0000\u0001\u001F', lastName: 'Doe' } },
      expectedFirstName: 'John\u0000\u0001\u001F'
    },
    {
      name: 'should handle very long strings',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id name { firstName lastName }
          }
        }
      `,
      variables: { author: { firstName: 'A'.repeat(1000), lastName: 'Doe' } },
      expectedFirstName: 'A'.repeat(1000)
    }
  ]

  let service, services
  t.before(async () => {
    services = await createGraphqlServices(t, [
      {
        name: 'authors-subgraph',
        file: path.join(__dirname, 'fixtures/authors.js'),
        listen: true
      }
    ])
    const options = {
      subgraphs: services.map((service) => ({
        name: service.name,
        server: { host: service.host }
      }))
    }

    const s = await createComposerService(t, { compose, options })
    service = s.service
  })

  t.beforeEach(() => {
    services.forEach((s) => s.config.reset())
  })

  for (const tc of testCases) {
    await t.test(tc.name, async (t) => {
      const result = await graphqlRequest(service, tc.query, tc.variables)
      assert.strictEqual(result.createAuthor.name.firstName, tc.expectedFirstName)
    })
  }
})

test('should handle non-string values with JSON.stringify', async (t) => {
  const testCases = [
    {
      name: 'should handle boolean values',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id
          }
        }
      `,
      variables: {
        author: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            street: 'Main St',
            city: 'NYC',
            zip: 10001,
            country: 'US',
            mainResidence: true
          }
        }
      }
    },
    {
      name: 'should handle numeric values',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id
          }
        }
      `,
      variables: {
        author: {
          firstName: 'John',
          lastName: 'Doe',
          address: {
            street: 'Main St',
            city: 'NYC',
            zip: 12345,
            country: 'US',
            mainResidence: false
          }
        }
      }
    },
    {
      name: 'should handle null values',
      query: `
        mutation CreateAuthor($author: AuthorInput!) {
          createAuthor(author: $author) {
            id
          }
        }
      `,
      variables: {
        author: {
          firstName: 'John',
          lastName: 'Doe',
          address: null
        }
      }
    }
  ]

  let service, services
  t.before(async () => {
    services = await createGraphqlServices(t, [
      {
        name: 'authors-subgraph',
        file: path.join(__dirname, 'fixtures/authors.js'),
        listen: true
      }
    ])
    const options = {
      subgraphs: services.map((service) => ({
        name: service.name,
        server: { host: service.host }
      }))
    }

    const s = await createComposerService(t, { compose, options })
    service = s.service
  })

  t.beforeEach(() => {
    services.forEach((s) => s.config.reset())
  })

  for (const tc of testCases) {
    await t.test(tc.name, async (t) => {
      const result = await graphqlRequest(service, tc.query, tc.variables)
      assert.ok(result.createAuthor.id)
    })
  }
})
