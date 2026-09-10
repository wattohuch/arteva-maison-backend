/**
 * Every payment path prices a promo code.
 *
 * The discount lives in one calculator, but it only reaches a customer if the
 * route that builds their order actually calls it. That is where this went
 * wrong: MyFatoorah has three order-creating routes and only executePayment
 * looked at a promo code, so an order built by createPaymentSession was quoted
 * a discount at checkout and charged the full amount.
 *
 * A unit test cannot catch that - the calculator was never the problem. This
 * reads the payment controllers instead and asserts that every function which
 * creates an order also prices a promo code against it, so a new payment
 * method cannot quietly ship without one.
 *
 * Run: npm run test:promo-coverage
 */
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
    cond ? pass++ : fail++;
};

const CONTROLLERS = [
    'paymentControllerMyFatoorah.js',
    'paymentControllerDeema.js',
    'orderController.js',
];

/**
 * Routes that create an order without pricing a promo code, and why.
 *
 * Anything here is a deliberate exception with a reason. An entry that stops
 * being true should be deleted, not updated to match the code.
 */
const EXEMPT = {
    // Cash on delivery was retired. The handler throws before it reaches any
    // of the order-building code below it, so no COD order is ever created.
    processCOD: 'retired - throws PAYMENT_METHOD_NOT_OFFERED before creating anything',
};

/** Split a controller into top-level `const NAME = asyncHandler(...)` blocks. */
function functionsIn(source) {
    const re = /const\s+([A-Za-z0-9_]+)\s*=\s*asyncHandler\(/g;
    const starts = [];
    let m;
    while ((m = re.exec(source)) !== null) starts.push({ name: m[1], at: m.index });

    return starts.map((s, i) => ({
        name: s.name,
        body: source.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : source.length),
    }));
}

for (const file of CONTROLLERS) {
    const full = path.join(__dirname, '..', 'src', 'controllers', file);
    const source = fs.readFileSync(full, 'utf8');
    const fns = functionsIn(source);

    check(`${file}: parsed into handlers`, fns.length > 0, 'found none - has the file structure changed?');

    const creators = fns.filter(f => /Order\.createWithRetry\s*\(/.test(f.body));
    check(`${file}: has at least one order-creating handler`, creators.length > 0);

    for (const fn of creators) {
        if (EXEMPT[fn.name]) {
            const stillThrows = /throw\s+ApiError\.badRequest\(/.test(fn.body);
            check(`  ${fn.name} is exempt and still refuses outright`, stillThrows, EXEMPT[fn.name]);
            continue;
        }

        const prices = /promoService\.buildOrderPromo\s*\(/.test(fn.body);
        check(`  ${fn.name} prices a promo code`, prices,
            'creates an order without ever looking at one - a discount quoted at checkout would not be charged');

        /* Either shape counts: passed into createWithRetry, or assigned onto an
           order that already exists. The variable holding it is named
           differently per controller, so this matches the assignment and not
           the name - a test that insists on `promoData` fails on Deema's
           `promoCodeData` while the order is recorded perfectly well. */
        const stores = /promoCode:\s*promo\w*/.test(fn.body)
            || /order\.promoCode\s*=\s*promo\w*/.test(fn.body);
        check(`  ${fn.name} records it on the order`, stores,
            'without this the order cannot report or reverse the discount');

        const subtracts = /-\s*totalDiscount/.test(fn.body);
        check(`  ${fn.name} subtracts it from the total`, subtracts,
            'priced but never taken off what the customer pays');
    }
}

// The calculator itself must stay in one place: a second copy is how the quote
// and the charge drifted apart before.
const service = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'promoService.js'), 'utf8'
);
check('the discount calculator is exported from one service',
    /function calculateDiscount\(/.test(service) && /calculateDiscount,/.test(service));

for (const file of CONTROLLERS) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', file), 'utf8');
    const reimplements = /discountType\s*===\s*'percentage'/.test(source);
    check(`${file} does not re-implement the discount arithmetic`, !reimplements,
        'a second copy of the calculation is how the quote and the charge drifted apart');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
