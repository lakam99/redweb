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
}
void ValidatedPage;
