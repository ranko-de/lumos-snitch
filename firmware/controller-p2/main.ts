/**
 * Lumos & Snitch — controller firmware (MakeCode TypeScript, micro:bit v2).
 *
 * The ONLY difference between controller-p1 and controller-p2 is PLAYER_ID.
 * Protocol: see docs/PROTOCOL.md (12-byte binary packet, well under the
 * 19-byte radio.sendBuffer limit).
 */
const PLAYER_ID = 2
const RADIO_GROUP = 42
const PROTOCOL_VERSION = 1
const PACKET_SIZE = 12
/** 180 / PI * 10 — angles are sent in tenths of a degree. */
const RAD_TO_DECIDEG = 572.9578

radio.setGroup(RADIO_GROUP)
radio.setTransmitPower(7)

let seq = 0
let aPresses = 0

// Count A press-down events, so a short tap between two packets is never lost.
control.onEvent(EventBusSource.MICROBIT_ID_BUTTON_A, EventBusValue.MICROBIT_BUTTON_EVT_DOWN, function () {
    aPresses = (aPresses + 1) % 256
})

// Show the player number briefly, then keep the LEDs dark:
// the light sensor uses the LED matrix, so no animations during play.
basic.showNumber(PLAYER_ID)
basic.pause(500)
basic.clearScreen()
// The first light reading after start-up can be 0 — read once and discard.
input.lightLevel()
basic.pause(100)

const packet = pins.createBuffer(PACKET_SIZE)

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v))
}

basic.forever(function () {
    // Tilt from the accelerometer only (no compass, no gyroscope).
    const ax = input.acceleration(Dimension.X)
    const ay = input.acceleration(Dimension.Y)
    const az = input.acceleration(Dimension.Z)
    const pitch = Math.atan2(ay, Math.sqrt(ax * ax + az * az)) * RAD_TO_DECIDEG
    const roll = Math.atan2(ax, Math.sqrt(ay * ay + az * az)) * RAD_TO_DECIDEG
    const light = input.lightLevel()

    let buttons = 0
    if (input.buttonIsPressed(Button.A)) buttons |= 1
    if (input.buttonIsPressed(Button.B)) buttons |= 2

    packet.setNumber(NumberFormat.UInt8LE, 0, PROTOCOL_VERSION)
    packet.setNumber(NumberFormat.UInt8LE, 1, PLAYER_ID)
    packet.setNumber(NumberFormat.UInt16LE, 2, seq)
    packet.setNumber(NumberFormat.Int16LE, 4, clamp(Math.round(pitch), -900, 900))
    packet.setNumber(NumberFormat.Int16LE, 6, clamp(Math.round(roll), -900, 900))
    packet.setNumber(NumberFormat.UInt8LE, 8, clamp(light, 0, 255))
    packet.setNumber(NumberFormat.UInt8LE, 9, buttons)
    packet.setNumber(NumberFormat.UInt8LE, 10, aPresses)
    let check = 0
    for (let i = 0; i < PACKET_SIZE - 1; i++) {
        check = check ^ packet.getNumber(NumberFormat.UInt8LE, i)
    }
    packet.setNumber(NumberFormat.UInt8LE, 11, check)
    radio.sendBuffer(packet)

    seq = (seq + 1) % 65536
    // ~20 packets per second with a little random jitter, so the two
    // controllers do not keep colliding on the radio.
    basic.pause(40 + randint(0, 12))
})
