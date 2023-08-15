'use strict';
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
    getBooksByIds(id: [ID]!): [Book]!
  }
`;
let library;

function reset() {
  library = {
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
  };
}

reset();

const resolvers = {
  Query: {
    async getBook(_, { id }) {
      return library[id];
    },
    async getBookTitle(_, { id }) {
      return library[id]?.title;
    },
    async getBooksByIds(_, { id }) {
      return id.map((id) => { return library[id]; });
    }
  }
};
const entities = {
  Book: {
    referenceListResolverName: 'getBooksByIds',
    primaryKeyFields: ['id'],
    adapter(partialResult) {
      return {
        id: partialResult.id
      };
    }
  }
};

module.exports = { entities, reset, resolvers, schema };

