# `@platformatic/graphql-composer`

The GraphQL API Composer is a framework agnostic library for combining multiple GraphQL APIs, known as subgraphs, into a single API capable of querying data across any of its constituent subgraphs.

The Composer downloads each subgraph schema from the corresponding upstream servers. The subgraphs will be merged to create a supergraph API. The combined API exposes the original operations from each subgraph. Furthermore, types with the same name in multiple subgraphs are merged together into entities. 

## Getting Started

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
  getBooks(ids: [ID]!): [Book]!
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

type Author {
  id: ID!
}

type Book {
  id: ID!
  reviews: [Review]!
  author: Author
}

type ReviewWithBook {
  id: ID!
  rating: Int!
  content: String!
  book: Book!
}

type Query {
  getReview(id: ID!): Review
  getReviews(ids: [ID]!): Review
  getReviewBook(bookId: ID!): Book
}

type Mutation {
  createReview(review: ReviewInput!): Review!
}
```

When the `Books` and `Reviews` subgraphs are merged, the `Book` type becomes:

```graphql
TODO
type Book {
  # Common field used to uniquely identify a Book.
  id: ID!

  # Fields from the Books subgraph.
  title: String
  genre: BookGenre

  # Fields from the Reviews subgraph.
  rate: Int
  reviews: [Review]!
}
```

The following example shows how the GraphQL API Composer can be used with Fastify and Mercurius - see [/examples/getting-started.js](/examples/getting-started.js) for the full code.

```js
'use strict'

const { compose } = require('@platformatic/graphql-composer')
const Fastify = require('fastify')
const Mercurius = require('mercurius')

async function main () {
  // Get schema information from subgraphs
  const composer = await compose({
    subgraphs: [
      {
        // Books subgraph information
        name: 'books',
        // Subgraph server to connect to
        server: {
          host: booksServiceHost
        },
        // Configuration for working with Book entities in this subgraph
        entities: {
          Book: {
            pkey: 'id',
            // Resolver for retrieving multiple Books
            resolver: {
              name: 'getBooks',
              argsAdapter: (partialResults) => ({
                ids: partialResults.map(r => r.id)
              })
            }
          }
        }
      },
      {
        // Reviews subgraph information
        name: 'reviews',
        server: {
          host: reviewsServiceHost
        },
        // Configuration for Review entity
        entities: {
          Review: {
            pkey: 'id',
            // Resolver for retrieving multiple Books
            resolver: {
              name: 'getReviews',
              argsAdapter: (partialResults) => ({
                ids: partialResults.map(r => r.id)
              })
            }
          },
          // Book entity is here too
          Book: {
            pkey: 'id',
            // Resolver for retrieving multiple Books
            resolver: {
              name: 'getReviewBooks',
              argsAdapter: (partialResults) => ({
                bookIds: partialResults.map(r => r.id)
              })
            }
          }
        }
      }
    ]
  })

  // Create a Fastify server that uses the Mercurius GraphQL plugin
  const composerService = Fastify()

  composerService.register(Mercurius, {
    schema: composer.toSdl(),
    resolvers: composer.resolvers,
    graphiql: true
  })

  await composerService.ready()
  await composerService.listen()

  // Then query the composer service
  // { getBook (id: 1) { id title reviews { content rating } } }
}

main()
```

## API

### `compose(config)`

  - Arguments
    - `config` (object, optional) - A configuration object with the following schema.
      - `defaultArgsAdapter` (function, optional) - The default `argsAdapter` function for the entities.
      - `addEntitiesResolvers` (boolean, optional) - automatically add entities types and resolvers accordingly with configuration, see [composer entities section](#composer-entities).
      - `logger` (pino instance, optional) - The composer logger
      - `subgraphs` (array, optional) - Array of subgraph configuration objects with the following schema.
        - `name` (string, optional) - A unique name to identify the subgraph; if missing the default one is `#${index}`, where index is the subgraph index in the array.
        - `server` (object, required) - Configuration object for communicating with the subgraph server with the following schema:
          - `host` (string, required) - The host information to connect to.
          - `composeEndpoint` (string, optional) - The endpoint to retrieve the introspection query from. **Default:** `'/.well-known/graphql-composition'`. In case the endpoint is not available, a second call with introspection query will be sent to the `graphqlEndpoint`.
          - `graphqlEndpoint` (string, optional) - The endpoint to make GraphQL queries against. **Default:** `'/graphql'`.
        - `entities` (object, optional) - Configuration object for working with entities in this subgraph, the values are objects with the the following schema:
          - `resolver` (object, optional) - The resolver to retrieve a list of objects - should return a list - and should accept as a arguments a list of primary keys or foreign keys.
            - `name` (string, required) - The name of the resolver.
            - `argsAdapter (partialResults)` (function, optional) - This function is invoked with a subset of the result of the inital query; `partialResults` is an array of the parent node. It should return an object to be used as argument for `resolver` query.
          **Default:** if missing, the `defaultArgsAdapter` function will be used; if that is missing too, a [generic one](lib/utils.js#L3) will be used.
            - `partialResults` (function, optional) - The function to adapt the subset of the result to be passed to `argsAdapter` - usually is needed only on resolvers of `fkeys` and `many`.
          - `pkey` (string, required) - The primary key field to identify the entity.
          - `fkeys` (array of objects, optional) an array to describe the foreign keys of the entities, for example `fkeys: [{ type: 'Author', field: 'authorId' }]`.
            - `type` (string, required) - The entity type the foreign key is referrered to.
            - `field` (string, optional) - The foreign key field.
            - `as` (string, optional) - When using `addEntitiesResolvers`, it defines the name of the foreign entity as a field of the current one, as a single type.
            - `pkey` (string, optional) - The primary key of the foreign entity.
            - `subgraph` (string, optional) - The subgraph name of the foreign entity, where the resolver is located; if missing is intended the self.
            - `resolver` (object, optional) - The resolver definition to query the foreing entity, same structure as `entity.resolver`.
          - `many` (array of objects, optional) - Describe a 1-to-many relation - the reverse of the foreign key.
            - `type` (string, required) - The entity type where the entity is a foreign key.
            - `fkey` (string, optional) - The foreign key field in the referred entity.
            - `as` (string, required) - When using `addEntitiesResolvers`, it defines the name of the relation as a field of the current one, as a list.
            - `pkey` (string, optional) - The primary key of the referred entity.
            - `subgraph` (string, optional) - The subgraph name of the referred entity, where the resolver is located; if missing is intended the self.
            - `resolver` (object, required) - The resolver definition to query the referred entity, same structure as `entity.resolver`.
      - `onSubgraphError` (function, optional) - Hook called when an error occurs getting schema from a subgraph. The default function will throw the error. The arguments are:
          - `error` (error) - The error.
          - `subgraph` (string) - The erroring subgraph name.
      - `queryTypeName` (string, optional) - The name of the `Query` type in the composed schema. **Default:** `'Query'`.
      - `mutationTypeName` (string, optional) - The name of the `Mutation` type in the composed schema. **Default:** `'Mutation'`.

  - Returns
    - A `Promise` that resolves with a `Composer` instance.

When this function is called, all of the subgraph schemas are retrieved and merged into a supergraph. A `Promise` resolving to a `Composer` instance is returned.

### `Composer` class

Instances of the `Composer` class are returned from the `compose()` function. The `Composer` constructor is not exposed as part of the public API.

#### `Composer.prototype.toSdl()`

  - Arguments
    - None
  - Returns
    - `SDL` string

Returns the SDL of the supergraph as a string; this can be passed to the GraphQL service as a schema definition.

#### `Composer.prototype.toSchema()`

  - Arguments
    - None
  - Returns
    - `IntrospectionQuery` object

Returns the supergraph schema as a GraphQL `IntrospectionQuery` object. This representation can be passed to other functions such as GraphQL's `buildClientSchema()` function.

#### `composer.resolvers`

An object containing the GraphQL resolver information for the supergraph.
