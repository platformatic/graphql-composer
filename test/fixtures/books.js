'use strict'
const schema = `
  enum BookGenre {
    FICTION
    NONFICTION
  }

  type ChapterData {
    title: String
    pageCount: Int
  }

  type Book {
    id: ID!
    title: String
    genre: BookGenre
    firstChapter: ChapterData
    lastChapter: ChapterData
  }

  enum BookField {
    id, title, genre
  }

  enum OrderDirection {
    ASD, DESC
  }

  input BookOrderField {
    field: BookField
    direction: OrderDirection
  }

  type Query {
    getBook(id: ID!): Book
    getBookTitle(id: ID!): String
    getBooksByIds(ids: [ID]!): [Book]!
    getBooks(limit: Int, orderBy: [BookOrderField]): [Book]
  }
`
const data = { library: null }

function reset () {
  data.library = {
    1: {
      id: 1,
      title: 'A Book About Things That Never Happened',
      genre: 'FICTION',
      firstChapter: {
        title: 'The Beginning',
        pageCount: 20
      },
      lastChapter: {
        title: 'The End',
        pageCount: 25
      }
    },
    2: {
      id: 2,
      title: 'A Book About Things That Really Happened',
      genre: 'NONFICTION',
      firstChapter: {
        title: 'Introduction',
        pageCount: 15
      },
      lastChapter: {
        title: 'Conclusion',
        pageCount: 18
      }
    }
  }
}

reset()

const resolvers = {
  Query: {
    getBook (_, { id, genre }) {
      if (genre) {
        return data.library[id]?.genre === genre ? data.library[id] : null
      }
      return data.library[id]
    },
    getBookTitle (_, { id }) {
      return data.library[id]?.title
    },
    getBooksByIds (_, { ids }) {
      return ids
        .map((id) => { return data.library[id] })
        .filter(b => !!b)
    },
    getBooks (_, { limit, orderBy }) {
      const books = structuredClone(Object.values(data.library))
      for (const order of orderBy) {
        books.sort((a, b) => order.direction === 'DESC' ? (a[order.field] > b[order.field] ? 1 : -1) : (b[order.field] > a[order.field] ? 1 : -1))
      }
      return books.slice(0, limit)
    }
  }
}
const entities = {
  Book: {
    pkey: 'id',
    resolver: {
      name: 'getBooksByIds',
      argsAdapter (partialResults) {
        return {
          ids: partialResults.map(r => r.bookId)
        }
      }
    }
  }
}

module.exports = { entities, reset, resolvers, schema, data }
