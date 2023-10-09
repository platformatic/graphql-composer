# `@platformatic/graphql-composer`

The GraphQL API Composer is a framework agnostic library for combining multiple GraphQL APIs, known as subgraphs, into a single API capable of querying data across any of its constituent subgraphs.

## Example

Given the following `Books` subgraph schema:

```graphql
enum BookGenre {
  FICTION
  NONFICTION
}

type Book {
  id: ID!
  title: String
  genre: BookGenre
}

type Query {
  getBook(id: ID!): Book
  getBooksByIds(id: [ID]!): [Book]!
}
```

And the following `Reviews` subgraph schema:

```graphql
input ReviewInput {
  bookId: ID!
  rating: Int!
  content: String!
}

type Review {
  id: ID!
  rating: Int!
  content: String!
}

type Book {
  id: ID!
  reviews: [Review]!
}

type ReviewWithBook {
  id: ID!
  rating: Int!
  content: String!
  book: Book!
}

type Query {
  getReview(id: ID!): Review
  getReviewBook(id: ID!): Book
  getReviewBookByIds(ids: [ID]!): [Book]!
  getReviewsByBookId(id: ID!): [Review]!
}

type Mutation {
  createReview(review: ReviewInput!): Review!
}

type Subscription {
  reviewPosted: ReviewWithBook!
}
```

The Composer will download each subgraph schema from the corresponding upstream servers. The two subgraphs will be merged to create a supergraph API. The combined API exposes the original operations from each subgraph. Furthermore, types with the same name in multiple subgraphs are merged together into entities. For example, when the `Books` and `Reviews` subgraphs are merged, the `Book` type becomes:

```graphql
type Book {
  # Common field used to uniquely identify a Book.
  id: ID!

  # Fields from the Books subgraph.
  title: String
  genre: BookGenre

  # Fields from the Reviews subgraph.
  reviews: [Review]!
}
```

The following example shows how the GraphQL API Composer can be used with Fastify and Mercurius.

```js
'use strict';
const { compose } = require('@platformatic/graphql-composer')
const Fastify = require('fastify')
const { buildClientSchema } = require('graphql')
const Mercurius = require('mercurius')

async function main() {
  const composer = await compose({
    subgraphs: [
      { // Books subgraph information.
        // Subgraph server to connect to.
        server: {
          host: 'localhost:3000',
          // Endpoint for retrieving introspection schema.
          composeEndpoint: '/graphql-composition',
          // Endpoint for GraphQL queries.
          graphqlEndpoint: '/graphql'
        },
        entities: {
          // Configuration for working with Book entities in this subgraph.
          Book: {
            // Resolver for retrieving multiple Books by their primary key.
            referenceListResolverName: 'getBooksByIds',
            // Field(s) necessary to identify any individual Book object.
            primaryKeyFields: ['id'],
            // A function to map a partial result from another subgraph(s) to
            // the primary key fields.
            adapter (partialResult) {
              return {
                id: partialResult.id
              }
            }
          }
        },
      },
      { // Reviews subgraph information.
        ...
      }
    ],
    // Hooks for subscriptions.
    subscriptions: {
      onError (ctx, topic, error) {
        throw error;
      },
      publish (ctx, topic, payload) {
        ctx.pubsub.publish({
          topic,
          payload
        })
      },
      subscribe (ctx, topic) {
        return ctx.pubsub.subscribe(topic)
      },
      unsubscribe (ctx, topic) {
        ctx.pubsub.close()
      }
    }
  })

  // Create a Fastify server that uses the Mercurius GraphQL plugin.
  const router = Fastify()

  router.register(Mercurius, {
    schema: buildClientSchema(composer.toSchema()),
    resolvers: composer.resolvers,
    subscription: true
  })

  await router.ready()
  router.graphql.addHook('onSubscriptionEnd', composer.onSubscriptionEnd)
  await router.listen()
}

main()
```

## API

### `compose(config)`

  - Arguments
    - `config` (object) - A configuration object with the following schema.
      - `subgraphs` (array) - Array of subgraph configuration objects with the following schema.
        - `server` (object) - Configuration object for communicating with the subgraph server with the following schema:
          - `host` (string) - The host information to connect to.
          - `composeEndpoint` (string) - The endpoint to retrieve the introspection query from.
          - `graphqlEndpoint` (string) - The endpoint to make GraphQL queries against.
        - `entities` (object) - Configuration object for working with entities in this subgraph. Each key in this object is the name of an entity data type. The values are objects with the the following schema:
          - `adapter(partialResult)` (function) - A function that maps a partial response into an object including the primary key fields.
          - `primaryKeyFields` (array of strings) - The fields used to uniquely identify objects of this type.
          - `referenceListResolverName` (string) - The name of a resolver used to retrieve a list of objects by their primary keys.
      - `subscriptions` (object) - Subscription hooks with the following schema.
        - `onError(ctx, topic, error)` (function) - Hook called when a subscription error occurs. The arguments are:
          - `ctx` (any) - GraphQL context object.
          - `topic` (string) - The subscription topic.
          - `error` (error) - The subscription error.
        - `publish(ctx, topic, payload)` (function) - Hook called to publish new data to a topic. The arguments are:
          - `ctx` (any) - GraphQL context object.
          - `topic` (string) - The subscription topic.
          - `payload` (object) - The subscriptiondata to publish.
        - `subscribe(ctx, topic)` (function) - Hook called to subscribe to a topic. The arguments are:
          - `ctx` (any) - GraphQL context object.
          - `topic` (string) - The subscription topic.
        - `unsubscribe(ctx, topic)` (function) - Hook called to unsubscribe from a topic. The arguments are:
          - `ctx` (any) - GraphQL context object.
          - `topic` (string) - The subscription topic.
  - Returns
    - A `Promise` that resolves with a `Composer` instance.

When this function is called, all of the subgraph schemas are retrieved and merged into a supergraph. A `Promise` resolving to a `Composer` instance is returned.

### `Composer` class

Instances of the `Composer` class are returned from the `compose()` function. The `Composer` constructor is not exposed as part of the public API.

#### `Composer.prototype.toSchema()`

  - Arguments
    - None
  - Returns
    - `IntrospectionQuery` object

Returns the supergraph schema as a GraphQL `IntrospectionQuery` object. This representation can be passed to other functions such as GraphQL's `buildClientSchema()` function.

#### `composer.resolvers`

An object containing the GraphQL resolver information for the supergraph.

#### `onSubscriptionEnd(ctx, topic)`

  - Arguments
    - `ctx` (any) - GraphQL context object.
    - `topic` (string) - The subscription topic.
  - Returns
    - Nothing

A function that should be called by the GraphQL router when a client subscription has ended.
