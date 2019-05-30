import { ApolloServer } from 'apollo-server';

import { generateSchema } from './graphql-schema';

async function startApp() {
  const server = new ApolloServer({
    schema: await generateSchema(),
  });

  return server.listen();
}

startApp().then(({ url }) => {
  console.log(`App is ready at ${url}`);
});
