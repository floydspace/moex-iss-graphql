import axios from 'axios';
import { pascalCase, snakeCase } from 'change-case';
import * as cheerio from 'cheerio';
import {
  GraphQLFieldConfig,
  GraphQLFieldConfigArgumentMap,
  GraphQLFieldConfigMap,
  GraphQLFloat,
  GraphQLInt,
  GraphQLList,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';
import { GraphQLDateTime } from 'graphql-iso-date';
import { singular } from 'pluralize';

const BASE_URL = 'https://iss.moex.com/iss';

const TypeMappings: { [key: string]: GraphQLScalarType } = {
  int32: GraphQLInt,
  int64: GraphQLInt,
  string: GraphQLString,
  datetime: GraphQLDateTime,
  double: GraphQLFloat,
};

export async function generateSchema(): Promise<GraphQLSchema> {
  const queries = await Promise.all([
    generateQueries(5),
    generateQueries(24),
    generateQueries(40),
    generateQueries(127),
    generateQueries(132),
    // generateQueries(191),
    // generateQueries(193),
  ]);

  const query = new GraphQLObjectType({
    name: 'MoexIssQueries',
    fields: () => queries.reduce((acc, q) => ({...acc, ...q}), {} as GraphQLFieldConfigMap<void, void>)
  });

  return new GraphQLSchema({ query });
}

async function generateQueries(ref: number) {
  const refUrl = `${BASE_URL}/reference/${ref}`;
  const refContent = await axios.get(refUrl).then(res => res.data);
  const { path, blocks } = parseDocs(refContent);

  const entityUrl = `${BASE_URL}/${path}.json`;
  const metaResult = await axios.get(`${entityUrl}?iss.meta=on&iss.data=off`).then(res => res.data);

  return blocks.reduce((queries, block) => {
    const metadata = metaResult[block.name].metadata;
    return {
      ...queries,
      [block.name]: {
        type: new GraphQLList(new GraphQLObjectType({
          name: pascalCase(singular(block.name)),
          fields: () => Object.keys(metadata).reduce((fields, field) => {
            return {
              ...fields,
              [snakeCase(field)]: {
                type: TypeMappings[metadata[field].type],
                resolve: parent => normalizeFieldValue(metadata[field].type, parent[field])
              }
            };
          }, {} as GraphQLFieldConfigMap<void, void>)
        })),
        description: block.description,
        args: block.args.reduce((args, arg) => {
          return {
            ...args,
            [arg]: { type: GraphQLString }
          };
        }, {} as GraphQLFieldConfigArgumentMap),
        resolve: async (_, args) => {
          const queryParams = [
            'iss.meta=off',
            'iss.data=on',
            'iss.json=extended',
            `iss.only=${block.name}`,
            ...Object.keys(args).map(key => `${key}=${args[key]}`)
          ].join('&');
          const response = await axios.get(`${entityUrl}?${queryParams}`);
          return response.data[1][block.name];
        }
      } as GraphQLFieldConfig<void, void>
    };
  }, {} as GraphQLFieldConfigMap<void, void>);
}

function normalizeFieldValue(type: string, value: any) {
  if (type === 'datetime' && value) {
    return value.trim().replace(' ', 'T') + '+03:00'; // Moscow timezone
  }
  return value;
}

function parseDocs(body: string): Reference {
  const $ = cheerio.load(body);
  const path = $('body > h1').text().match(/\/iss\/(.*)/)[1];
  const blocks: Block[] = $('body > dl > dt')
    .map((_, el) => {
      return {
        name: $(el).text().split(' ')[0],
        description: $(el).next().find('> pre').text().trim(),
        args: $(el).next().find('> dl > dt').map((__, dt) => $(dt).text()).get()
      } as Block;
    })
    .get();
  return { path, blocks };
}

interface Reference {
  path: string;
  blocks: Block[];
}

interface Block {
  name: string;
  description: string;
  args: string[];
}
