'use strict'

const schema = `
  input WhereConditionIn {
    in: [ID!]!
  }

  input RestaurantsWhereCondition {
    id: WhereConditionIn
  } 

  input RestaurantsFoodsWhereCondition {
    restaurantId: WhereConditionIn
    foodId: WhereConditionIn
  } 

  type Restaurant {
    id: ID!
    businessName: String
  }

  type RestaurantsFoods {
    restaurantId: ID!
    foodId: ID!
  }

  type Query {
    restaurants(where: RestaurantsWhereCondition): [Restaurant]
    restaurantsFoods(where: RestaurantsFoodsWhereCondition): [RestaurantsFoods]
  }
`

const data = {
  restaurants: null
}

function reset () {
  data.restaurantsFoods = [
    {
      restaurantId: 90,
      foodId: 50
    },
    {
      restaurantId: 90,
      foodId: 51
    },
    {
      restaurantId: 90,
      foodId: 52
    },

    {
      restaurantId: 91,
      foodId: 60
    },
    {
      restaurantId: 91,
      foodId: 61
    },
    {
      restaurantId: 91,
      foodId: 62
    },

    {
      restaurantId: 92,
      foodId: 60
    },
    {
      restaurantId: 92,
      foodId: 63
    }
  ]

  data.restaurants = {
    90: {
      id: 90,
      businessName: 'Pizzeria Napoletana'
    },
    91: {
      id: 91,
      businessName: 'Ristorante Stellato'
    },
    92: {
      id: 92,
      businessName: 'Trattoria da Gigi'
    }
  }
}

reset()

const resolvers = {
  Query: {
    restaurants (_, { where }) {
      return Object.values(data.restaurants)
        .filter(r => where.id.in.includes(String(r.id)))
    },
    restaurantsFoods (_, { where }) {
      if (where.restaurantId?.in) {
        return data.restaurantsFoods
          .filter(rf => where.restaurantId.in.includes(String(rf.restaurantId)))
      }
      if (where.foodId?.in) {
        return data.restaurantsFoods
          .filter(rf => where.foodId.in.includes(String(rf.foodId)))
      }
    }
  }
}

module.exports = { name: 'restaurants-subgraph', schema, reset, resolvers, data }
