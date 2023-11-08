'use strict'

const assert = require('node:assert')
const t = require('node:test')
const { QueryBuilder } = require('../lib/query-builder')

t.test('QueryBuilder', (t) => {
  t.test('partialResults', () => {
    const cases = [
      {
        result: { getReviewBook: { id: '1', reviews: [{ id: '1', rating: 2, content: 'Would not read again.' }] } },
        path: ['getReviewBook'],
        expected: [{ id: '1', reviews: [{ id: '1', rating: 2, content: 'Would not read again.' }] }]
      },
      {
        result: { getBooks: [{ id: '1', title: 'A Book About Things That Never Happened', genre: 'FICTION' }] },
        path: ['getBooks'],
        expected: [{ id: '1', title: 'A Book About Things That Never Happened', genre: 'FICTION' }]
      },
      {
        result: { getReviewBook: { id: '1', reviews: [{ id: '1', rating: 2, content: 'Would not read again.' }] } },
        path: ['getReviewBook'],
        expected: [{ id: '1', reviews: [{ id: '1', rating: 2, content: 'Would not read again.' }] }]
      },
      {
        result: { getReviewBookByIds: [{ reviews: [{ rating: 2 }], id: '1' }, { reviews: [{ rating: 3 }], id: '2' }, { reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }], id: '3' }] },
        path: ['getReviewBookByIds'],
        expected: [{ reviews: [{ rating: 2 }], id: '1' }, { reviews: [{ rating: 3 }], id: '2' }, { reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }], id: '3' }]
      },
      {
        result: { getReviewBookByIds: [{ reviews: [{ rating: 2 }], id: '1' }, { reviews: [{ rating: 3 }], id: '2' }, { reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }], id: '3' }] },
        path: ['getReviewBookByIds', 'author'],
        expected: [null, null, null]
      },
      {
        result: { getReviewBookByIds: [{ reviews: [{ rating: 2 }], id: '1' }, { reviews: [{ rating: 3 }], id: '2' }, { reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }], id: '3' }] },
        path: ['getReviewBookByIds'],
        expected: [{ reviews: [{ rating: 2 }], id: '1' }, { reviews: [{ rating: 3 }], id: '2' }, { reviews: [{ rating: 3 }, { rating: 5 }, { rating: 1 }], id: '3' }]
      },
      {
        result: { getReviewBookByIds: [{ reviews: [{ rating: 2 }], id: '1' }] },
        path: ['getReviewBookByIds'],
        expected: [{ reviews: [{ rating: 2 }], id: '1' }]
      },
      {
        result: { getReviewBookByIds: [] },
        path: ['getReviewBookByIds'],
        expected: []
      },
      {
        result: { booksByAuthors: [{ title: 'A Book About Things That Never Happened', author: { id: '10' }, id: '1' }, { title: 'A Book About Things That Really Happened', author: { id: '10' }, id: '2' }, { title: 'From the universe', author: { id: '11' }, id: '3' }, { title: 'From another world', author: { id: '11' }, id: '4' }] },
        path: ['booksByAuthors', 'author'],
        expected: [{ id: '10' }, { id: '10' }, { id: '11' }, { id: '11' }]
      },
      {
        result: { reviewPosted: { id: '5', rating: 10, content: 'Not sure', book: { id: '1', reviews: [{ id: '1', rating: 2, content: 'Would not read again.' }, { id: '5', rating: 10, content: 'Not sure' }] } } },
        path: ['reviewPosted', 'book'],
        expected: [{ id: '1', reviews: [{ id: '1', rating: 2, content: 'Would not read again.' }, { id: '5', rating: 10, content: 'Not sure' }] }]
      },
      {
        result: { booksByAuthors: [{ title: 'A Book About Things That Never Happened', author: { id: '10' }, id: '1' }, { title: 'A Book About Things That Really Happened', author: { id: '10' }, id: '2' }, { title: 'Watering the plants', author: { id: '11' }, id: '3' }, { title: 'Pruning the branches', author: { id: '11' }, id: '4' }] },
        path: ['booksByAuthors', 'author'],
        expected: [{ id: '10' }, { id: '10' }, { id: '11' }, { id: '11' }]
      },
      {
        result: { artists: [{ lastName: 'Singer1', songs: [{ id: '2' }], id: '201' }, { lastName: 'Singer2', songs: [{ id: '3' }, { id: '4' }], id: '301' }, { lastName: 'Singer3', songs: [{ id: '5' }, { id: '6' }], id: '401' }] },
        path: ['artists', 'songs'],
        expected: [{ id: '2' }, { id: '3' }, { id: '4' }, { id: '5' }, { id: '6' }]
      },
      {
        only: true,
        test: 'should traverse lists of lists',
        result: {
          getReviewBooks: {
            reviews: [
              { books: [{ title: 'book#1.1' }, { title: 'book#1.2' }] },
              { books: [{ title: 'book#2.1' }] },
              { books: [{ title: 'book#3.1' }, { title: 'book#3.2' }] }
            ]
          }
        },
        path: ['getReviewBooks', 'reviews', 'books'],
        expected: [{ title: 'book#1.1' }, { title: 'book#1.2' }, { title: 'book#2.1' }, { title: 'book#3.1' }, { title: 'book#3.2' }]
      },
      {
        result: { booksByAuthors: [{ title: 'A Book About Things That Never Happened', author: { id: '10' }, id: '1' }, { title: 'A Book About Things That Really Happened', author: { id: '10' }, id: '2' }, { title: 'Watering the plants', author: { id: '11' }, id: '3' }, { title: 'Pruning the branches', author: { id: '11' }, id: '4' }] },
        path: ['booksByAuthors', 'author', 'books']
      }
    ]

    const options = {
      info: { operation: { operation: 'query' } },
      type: { fieldMap: new Map() }
    }

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i]
      if (!c.only) { continue }
      const q = new QueryBuilder({ path: c.path, ...options })
      const testName = c.test ?? 'case #' + (i + 1)

      assert.deepStrictEqual(q.partialResults(c.result), c.expected, testName)
    }
  })
})
