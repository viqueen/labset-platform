import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import type { TableDescription } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { DynamoDbData, IDynamoDbData } from './data';
import { IDynamoDbMigration } from './migration';

interface IDynamoDbClients {
    ddb: () => DynamoDBClient;
    ddbDoc: () => DynamoDBDocumentClient;
    ddbData: () => IDynamoDbData;
    destroy: () => Promise<void>;
    upgrade: () => Promise<TableDescription[]>;
    rollback: () => Promise<TableDescription[]>;
}

type DynamoDbClientConfig = { region: string; endpoint?: string };

const localstackDynamoDbClientConfig = {
    region: 'us-east-1',
    endpoint: 'http://localhost:4566'
};

class DynamoDbClients implements IDynamoDbClients {
    private ddbInstance: DynamoDBClient | undefined;
    private ddbDocInstance: DynamoDBDocumentClient | undefined;
    private ddbDataInstance: IDynamoDbData | undefined;

    constructor(
        private readonly migrations: IDynamoDbMigration[],
        private readonly options: DynamoDbClientConfig
    ) {}

    ddb(): DynamoDBClient {
        if (this.ddbInstance) return this.ddbInstance;
        this.ddbInstance = new DynamoDBClient({
            region: this.options.region,
            endpoint: this.options.endpoint
        });
        return this.ddbInstance;
    }

    ddbData(): IDynamoDbData {
        if (this.ddbDataInstance) return this.ddbDataInstance;
        this.ddbDataInstance = new DynamoDbData();
        return this.ddbDataInstance;
    }

    ddbDoc(): DynamoDBDocumentClient {
        if (this.ddbDocInstance) return this.ddbDocInstance;
        const marshallOptions = {
            convertEmptyValues: false,
            removeUndefinedValues: true,
            convertClassInstanceToMap: true
        };
        const unmarshallOptions = {
            wrapNumbers: false
        };
        const ddbClient = this.ddb();
        const translateConfig = { marshallOptions, unmarshallOptions };
        this.ddbDocInstance = DynamoDBDocumentClient.from(
            ddbClient,
            translateConfig
        );
        return this.ddbDocInstance;
    }

    async destroy(): Promise<void> {
        this.ddbDocInstance?.destroy();
        this.ddbInstance?.destroy();
    }

    async upgrade(): Promise<TableDescription[]> {
        const ddbClient = this.ddb();
        const data = await ddbClient.send(new ListTablesCommand({}));
        const tableNames = data.TableNames ?? [];
        const result: TableDescription[] = [];
        for (const migration of this.migrations) {
            if (tableNames.some((t) => t === migration.TableName)) {
                continue;
            }
            const upgrades = await migration.up(ddbClient);
            if (upgrades) {
                result.push(upgrades);
            }
        }
        return result;
    }

    async rollback(): Promise<TableDescription[]> {
        const ddbClient = this.ddb();
        const data = await ddbClient.send(new ListTablesCommand({}));
        const tableNames = data.TableNames ?? [];
        const result: TableDescription[] = [];
        for (const migration of this.migrations) {
            if (tableNames.some((t) => t === migration.TableName)) {
                const downgrades = await migration.down(ddbClient);
                if (downgrades) {
                    result.push(downgrades);
                }
            }
        }
        return result;
    }
}

export type { IDynamoDbClients, DynamoDbClientConfig };

export { DynamoDbClients, localstackDynamoDbClientConfig };
