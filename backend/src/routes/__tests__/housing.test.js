const { housingRoutes } = require('../housing')

test('housing routes export a plugin', () => {
  expect(typeof housingRoutes).toBe('function')
})
