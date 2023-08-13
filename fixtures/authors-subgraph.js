'use strict';

const schema = `
  type AuthorTodo {
    task: String
  }

  type AuthorName {
    firstName: String
    lastName: String
  }

  type Author {
    id: ID
    name: AuthorName
    todos(id: ID!): [AuthorTodo]
  }

  type Query {
    get(id: ID!): Author
    list: [Author]
  }

  type Mutation {
    createAuthor: Author!
  }
`;
const authors = {
  1: {
    id: 1,
    name: {
      firstName: 'Peter',
      lastName: 'Pluck'
    }
  }
};
const todos = {
  1: {
    id: 1,
    authorId: 1,
    task: 'Write another book'
  },
  2: {
    id: 2,
    authorId: 1,
    task: 'Get really creative'
  }
};
const resolvers = {
  Query: {
    async get(_, { id }) {
      return authors[id];
    },
    async list() {
      return Object.values(authors);
    }
  },
  Mutation: {
    // TODO(cjihrig): Need to support input objects.
    async createAuthor() {
      const id = Object.keys(authors).length + 1;
      const author = {
        id,
        name: {
          firstName: 'John',
          lastName: 'Johnson'
        }
      };

      authors[id] = author;
      return author;
    }
  },
  Author: {
    async todos(_, { id }) {
      return Object.values(todos).filter((t) => {
        return String(t.id) === id;
      });
    }
  }
};

module.exports = { schema, resolvers };
