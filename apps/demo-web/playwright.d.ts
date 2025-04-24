declare module '@playwright/test' {
    export interface Page {
        goto(url: string): Promise<void>;
        waitForSelector(selector: string): Promise<void>;
        click(selector: string): Promise<void>;
        fill(selector: string, value: string): Promise<void>;
        locator(selector: string, options?: any): Locator;
        close(): Promise<void>;
    }

    export interface Locator {
        click(): Promise<void>;
        fill(value: string): Promise<void>;
        clear(): Promise<void>;
        should(assertion: string, value?: any): Promise<void>;
        toHaveClass(className: string | RegExp, options?: any): Promise<void>;
        toContainText(text: string, options?: any): Promise<void>;
        not: {
            toContainText(text: string, options?: any): Promise<void>;
            toHaveClass(className: string | RegExp): Promise<void>;
        };
    }

    export interface Browser {
        newContext(): Promise<BrowserContext>;
    }

    export interface BrowserContext {
        newPage(): Promise<Page>;
    }

    export interface Test {
        describe(name: string, fn: () => void): void;
        beforeAll(fn: (params: { browser: Browser }) => Promise<void>): void;
        afterAll(fn: () => Promise<void>): void;
    }

    export const test: Test;
    export function expect(locator: Locator): {
        toContainText(text: string, options?: any): Promise<void>;
        toHaveClass(className: string | RegExp, options?: any): Promise<void>;
        not: {
            toContainText(text: string, options?: any): Promise<void>;
            toHaveClass(className: string | RegExp): Promise<void>;
            toExist(): Promise<void>;
        };
    };
} 