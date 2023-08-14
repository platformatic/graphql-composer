'use strict';
const { deepStrictEqual } = require('node:assert');
const { test } = require('node:test');
const { gqlRequest, startRouter } = require('./helper');

test('proxy a simple single query to a single subgraph', async (t) => {
  const router = await startRouter(t, ['authors-subgraph']);
  const query = `
    query {
      list {
        id name { firstName lastName }
      }
    }
  `;
  const data = await gqlRequest(router, query);

  deepStrictEqual(data, {
    list: [{ id: '1', name: { firstName: 'Peter', lastName: 'Pluck' }}]
  });
});

test('query with a literal argument', async (t) => {
  const router = await startRouter(t, ['books-subgraph']);
  const query = `
    query {
      getBook(id: 1) {
        id genre
      }
    }
  `;
  const data = await gqlRequest(router, query);

  deepStrictEqual(data, {
    getBook: { id: '1', genre: 'FICTION' }
  });
});

test('query with a variable argument', async (t) => {
  const router = await startRouter(t, ['books-subgraph']);
  const query = `
    query GetBookById($id: ID!) {
      getBook(id: $id) {
        id genre
      }
    }
  `;
  const data = await gqlRequest(router, query, { id: 2 });

  deepStrictEqual(data, {
    getBook: { id: '2', genre: 'NONFICTION' }
  });
});

test('nested query with a literal argument', async (t) => {
  const router = await startRouter(t, ['authors-subgraph']);
  const query = `
    query {
      list {
        id
        name {
          firstName
          lastName
        }
        todos(id: 2) {
          task
        }
      }
    }
  `;
  const data = await gqlRequest(router, query);

  deepStrictEqual(data, {
    list: [
      {
        id: '1',
        name: {
          firstName: 'Peter',
          lastName: 'Pluck'
        },
        todos: [{ task: 'Get really creative' }]
      }
    ]
  });
});

test('nested query with a variable argument', async (t) => {
  const router = await startRouter(t, ['authors-subgraph']);
  const query = `
    query GetAuthorListWithTodos($id: ID!) {
      list {
        id
        name {
          firstName
          lastName
        }
        todos(id: $id) {
          task
        }
      }
    }
  `;
  const data = await gqlRequest(router, query, { id: 1 });

  deepStrictEqual(data, {
    list: [
      {
        id: '1',
        name: {
          firstName: 'Peter',
          lastName: 'Pluck'
        },
        todos: [{ task: 'Write another book' }]
      }
    ]
  });
});

test('support query aliases', async (t) => {
  const router = await startRouter(t, ['books-subgraph']);
  const query = `
    query {
      aliasedGetBook: getBook(id: 1) {
        id genre
      }
    }
  `;
  const data = await gqlRequest(router, query);

  deepStrictEqual(data, {
    aliasedGetBook: { id: '1', genre: 'FICTION' }
  });
});

test('scalar return type', async (t) => {
  const router = await startRouter(t, ['books-subgraph']);
  const query = `
    query {
      getBookTitle(id: 1)
    }
  `;
  const data = await gqlRequest(router, query);

  deepStrictEqual(data, {
    getBookTitle: 'A Book About Things That Never Happened'
  });
});

test('query with meta fields', async (t) => {
  const router = await startRouter(t, ['books-subgraph']);
  const query = `
    query {
      getBook(id: 1) {
        __typename
        ...on Book { id, genre }
      }
    }
  `;
  const data = await gqlRequest(router, query);

  deepStrictEqual(data, {
    getBook: {
      __typename: 'Book',
      id: '1',
      genre: 'FICTION'
    }
  });
});

test('query with a fragment', async (t) => {
  const router = await startRouter(t, ['books-subgraph']);
  const query = `
    fragment bookFields on Book { id title genre }

    query GetBookById($id: ID!) {
      getBook(id: $id) {
        ...bookFields
      }
    }
  `;
  const data = await gqlRequest(router, query, { id: 1 });

  deepStrictEqual(data, {
    getBook: {
      id: '1',
      genre: 'FICTION',
      title: 'A Book About Things That Never Happened'
    }
  });
});

test('resolves a partial entity from a single subgraph', async (t) => {
  const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph']);
  const query = `
    query {
      getReviewBook(id: 1) {
        id
        reviews {
          id
          rating
          content
        }
      }
    }
  `;
  const data = await gqlRequest(router, query);

  deepStrictEqual(data, {
    getReviewBook: {
      id: '1',
      reviews: [
        {
          id: '1',
          rating: 2,
          content: 'Would not read again.'
        }
      ]
    }
  });
});

test('resolves an entity across multiple subgraphs', async (t) => {
  const router = await startRouter(t, ['books-subgraph', 'reviews-subgraph']);

  await t.test('query flows from non-owner to owner subgraph', async (t) => {
    const query = `
      query {
        getReviewBook(id: 1) {
          id
          title
          genre
          reviews {
            id
            rating
            content
          }
        }
      }
    `;
    const data = await gqlRequest(router, query);

    deepStrictEqual(data, {
      getReviewBook: {
        id: '1',
        title: 'A Book About Things That Never Happened',
        genre: 'FICTION',
        reviews: [
          {
            id: '1',
            rating: 2,
            content: 'Would not read again.'
          }
        ]
      }
    });
  });

  await t.test('query flows from owner to non-owner subgraph', async (t) => {
    const query = `
      query {
        getBook(id: 1) {
          id
          title
          genre
          reviews {
            id
            rating
            content
          }
        }
      }
    `;
    const data = await gqlRequest(router, query);

    deepStrictEqual(data, {
      getBook: {
        id: '1',
        title: 'A Book About Things That Never Happened',
        genre: 'FICTION',
        reviews: [
          {
            id: '1',
            rating: 2,
            content: 'Would not read again.'
          }
        ]
      }
    });
  });

  await t.test('fetches foreign key fields not in selection set', async (t) => {
    const query = `
      query {
        getReviewBook(id: 1) {
          # id not included and it is part of the foreign key.
          title
          genre
          reviews {
            id
            rating
            content
          }
        }
      }
    `;
    const data = await gqlRequest(router, query);

    deepStrictEqual(data, {
      getReviewBook: {
        title: 'A Book About Things That Never Happened',
        genre: 'FICTION',
        reviews: [
          {
            id: '1',
            rating: 2,
            content: 'Would not read again.'
          }
        ]
      }
    });
  });

  await t.test('fetches primary key fields not in selection set', async (t) => {
    const query = `
      query {
        getBook(id: 1) {
          # id not included and it is part of the primary key.
          title
          genre
          reviews {
            id
            rating
            content
          }
        }
      }
    `;
    const data = await gqlRequest(router, query);

    deepStrictEqual(data, {
      getBook: {
        title: 'A Book About Things That Never Happened',
        genre: 'FICTION',
        reviews: [
          {
            id: '1',
            rating: 2,
            content: 'Would not read again.'
          }
        ]
      }
    });
  });
});

test('Mutations', async () => {
  await test('simple mutation', async (t) => {
    const router = await startRouter(t, ['authors-subgraph']);
    const query = `
      mutation CreateAuthor($author: AuthorInput!) {
        createAuthor(author: $author) {
          id name { firstName lastName }
        }
      }
    `;
    const author = { firstName: 'John', lastName: 'Johnson' };
    const data = await gqlRequest(router, query, { author });

    deepStrictEqual(data, {
      createAuthor: {
        id: '2',
        name: { firstName: 'John', lastName: 'Johnson' }
      }
    });
  });

  await test('simple mutation with input object literal', async (t) => {
    const router = await startRouter(t, ['authors-subgraph']);
    const query = `
      mutation {
        createAuthor(author: { firstName: "Tuco", lastName: "Gustavo" }) {
          id name { firstName lastName }
        }
      }
    `;
    const data = await gqlRequest(router, query);

    deepStrictEqual(data, {
      // TODO(cjihrig): Update tests to wipe data between each test.
      createAuthor: {
        id: '3',
        name: { firstName: 'Tuco', lastName: 'Gustavo' }
      }
    });
  });
});
