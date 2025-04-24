declare namespace Cypress {
    interface Chainable<Subject = any> {
        /**
         * Custom command to select DOM element by data-cy attribute.
         * @example cy.dataCy('greeting')
         */
        dataCy(value: string): Chainable<Element>;

        /**
         * Custom command to make an HTTP request and intercept it
         */
        intercept(method: string, url: string, response?: any): Chainable<Element>;
        intercept(method: string, url: string, handler?: (req: any) => void): Chainable<Element>;

        /**
         * Custom command to wait for a specific HTTP request
         */
        wait(alias: string): Chainable<Element>;

        /**
         * Custom command to visit a page
         */
        visit(url: string): Chainable<Element>;

        /**
         * Custom command to get an element by selector
         */
        get(selector: string): Chainable<Element>;

        /**
         * Custom command to find an element containing text
         */
        contains(text: string): Chainable<Element>;

        /**
         * Custom command to alias a route or element
         */
        as(name: string): Chainable<Element>;

        /**
         * Custom command to click on an element
         */
        click(): Chainable<Element>;

        /**
         * Custom command to type text into an element
         */
        type(text: string): Chainable<Element>;

        /**
         * Custom command to check if element has a class
         */
        should(assertion: string, value?: string): Chainable<Element>;

        /**
         * Custom command to clear an input field
         */
        clear(): Chainable<Element>;

        /**
         * Custom command to find element by test id
         */
        findByTestId(testId: string): Chainable<Element>;

        /**
         * Custom command to parent element
         */
        parent(): Chainable<Element>;

        /**
         * Custom command to find elements within another element
         */
        find(selector: string): Chainable<Element>;
    }
}

declare const cy: Cypress.Chainable;
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const beforeEach: (fn: () => void) => void; 