import { granolaConnector } from "../granolaConnector.js";
import { notionConnector } from "../notionConnector.js";
import { slackConnector } from "../slackConnector.js";
import type { ConnectorDefinition, ConnectorName } from "./types.js";

export const connectorDefinitions: readonly ConnectorDefinition[] = [
  notionConnector as ConnectorDefinition,
  granolaConnector as ConnectorDefinition,
  slackConnector as ConnectorDefinition,
];

export function listConnectorDefinitions(): readonly ConnectorDefinition[] {
  return connectorDefinitions;
}

export function getConnectorDefinition(name: ConnectorName): ConnectorDefinition | undefined {
  return connectorDefinitions.find((connector) => connector.name === name);
}
