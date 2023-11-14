'use strict'

const schema = `
  type Song {
    id: ID!
    title: String
    singerId: ID
  }

  type Query {
    songs(ids: [ID!]!): [Song]
  }

  type Artist {
    id: ID
    songs: [Song]
  }

  extend type Song {
    singer: Artist
  }

  extend type Query {
    songArtists (ids: [ID!]!): [Artist]
  }
`

const data = {
  songs: null
}

function reset () {
  data.songs = {
    1: {
      id: 1,
      title: 'Every you every me',
      singerId: 103
    },
    2: {
      id: 2,
      title: 'The bitter end',
      singerId: 103
    },
    3: {
      id: 3,
      title: 'Vieni via con me',
      singerId: 102
    }
  }
}

reset()

const resolvers = {
  Query: {
    async songs (_, { ids }) {
      return Object.values(data.songs).filter(a => ids.includes(String(a.id)))
    },
    songArtists: async (parent, args, context, info) => {
      return args.ids.map(id => ({ id }))
    }
  },
  Song: {
    singer: (parent, args, context, info) => {
      return parent?.singerId ? { id: parent.singerId } : null
    }
  },
  Artist: {
    // TODO dataloader here
    songs: (parent, args, context, info) => {
      return Object.values(data.songs).filter(a => String(a.singerId) === String(parent.id))
    }
  }
}

const entities = {
  Song: {
    referenceListResolverName: 'songs',
    keys: [{ field: 'id' }, { field: 'singerId', type: 'Artist' }]
  },
  Artist: {
    referenceListResolverName: 'songArtists',
    argsAdapter: (partialResults) => {
      return { ids: partialResults.map(r => r.id) }
    },
    keys: [{ field: 'id' }]
  }
}

module.exports = { name: 'songs', schema, reset, resolvers, entities, data }
