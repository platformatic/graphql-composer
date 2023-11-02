'use strict'
const schema = `
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
    getBookTitle(id: ID!): String
    getBooksByIds(ids: [ID]!): [Book]!
  }
`
const data = { library: null }

function reset () {
  data.library = {
    1: {
      id: 1,
      title: 'A Book About Things That Never Happened',
      genre: 'FICTION'
    },
    2: {
      id: 2,
      title: 'A Book About Things That Really Happened',
      genre: 'NONFICTION'
    }
  }
}

reset()

const resolvers = {
  Query: {
    async getBook (_, { id }) {
      return data.library[id]
    },
    async getBookTitle (_, { id }) {
      return data.library[id]?.title
    },
    async getBooksByIds (_, { ids }) {
      return ids.map((id) => { return data.library[id] })
    }
  }
}
const entities = {
  Book: {
    referenceListResolverName: 'getBooksByIds',
    keys: [{ field: 'id', type: 'Book' }],
    argsAdapter (partialResults) {
      return {
        ids: partialResults.map(r => r.id)
      }
    }
  }
}

module.exports = { name: 'books', entities, reset, resolvers, schema, data }
