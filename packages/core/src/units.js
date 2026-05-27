/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Convert a count of staff spaces into logical pixels for the given context.
// Every musical advance and glyph dimension is expressed as a multiple of the
// staff space, so this is the single place layout units are materialised.
export function ss(ctx, n) {
    return n * ctx.staffSpace;
}
