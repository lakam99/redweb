import { z } from 'zod';
import { action, type ActionInput, type LivePageConnectionContext } from 'redweb';

const schema = z.object({ amount: z.string().transform(Number) });
class ValidatedPage {
    @action({ input: schema })
    save(input: ActionInput<typeof schema>, context: LivePageConnectionContext) {
        const amount: number = input.amount;
        return `${context.principal}:${amount}`;
    }

    @action({ input: schema, validationTimeoutMs: 500 })
    saveWithoutContext(input: { amount: number }) { return input.amount; }

    // @ts-expect-error The action receives the transformed output, not the wire string.
    @action({ input: schema })
    wrong(input: { amount: string }) { return input; }

    // @ts-expect-error Standard Schema is required, not arbitrary parser options.
    @action({ input: {} })
    missingSchema(input: unknown) { return input; }

    @action({ input: schema, authorize: (context, input) => {
        const amount: number = input.amount;
        // @ts-expect-error Policy input has already been transformed.
        const raw: string = input.amount;
        void raw;
        return context.principal === 'owner' && amount <= 10;
    }, authorizationTimeoutMs: 500 })
    authorized(input: ActionInput<typeof schema>, context: LivePageConnectionContext) {
        return `${context.principal}:${input.amount}`;
    }

    @action({ authorize: context => context.principal === 'owner' })
    button(_input: unknown, context: LivePageConnectionContext) { return context.principal; }

    // @ts-expect-error Without a schema the submitted input is untrusted unknown, not context.
    @action({ authorize: context => context.principal === 'owner' })
    misplacedContext(context: LivePageConnectionContext) { return context.principal; }

    // @ts-expect-error Permission policies must return a boolean, not a truthy identity.
    @action({ input: schema, authorize: () => 'owner' })
    truthyPolicy(input: ActionInput<typeof schema>) { return input; }

    // @ts-expect-error A policy timeout requires a permission callback.
    @action({ input: schema, authorizationTimeoutMs: 5 })
    orphanTimeout(input: ActionInput<typeof schema>) { return input; }
}
void ValidatedPage;
