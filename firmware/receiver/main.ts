/**
 * Lumos & Snitch — radio → USB bridge (MakeCode TypeScript, micro:bit v2).
 *
 * Receives the controllers' 12-byte packets and writes one JSON object per
 * line (NDJSON) to USB serial at 115200 baud. Nothing else is ever written to
 * the serial port, so the browser can parse every line.
 */
const RADIO_GROUP = 42
const PROTOCOL_VERSION = 1
const PACKET_SIZE = 12

radio.setGroup(RADIO_GROUP)
serial.redirectToUSB()
serial.setBaudRate(BaudRate.BaudRate115200)

// A small static icon so you can see the bridge is running.
basic.showLeds(`
    . . . . .
    . # . # .
    . . # . .
    . # . # .
    . . . . .
    `)

let received = 0

radio.onReceivedBuffer(function (packet: Buffer) {
    if (packet.length != PACKET_SIZE) return
    if (packet.getNumber(NumberFormat.UInt8LE, 0) != PROTOCOL_VERSION) return
    let check = 0
    for (let i = 0; i < PACKET_SIZE - 1; i++) {
        check = check ^ packet.getNumber(NumberFormat.UInt8LE, i)
    }
    if (check != packet.getNumber(NumberFormat.UInt8LE, PACKET_SIZE - 1)) return
    const player = packet.getNumber(NumberFormat.UInt8LE, 1)
    if (player != 1 && player != 2) return

    const seq = packet.getNumber(NumberFormat.UInt16LE, 2)
    const pitch = packet.getNumber(NumberFormat.Int16LE, 4)
    const roll = packet.getNumber(NumberFormat.Int16LE, 6)
    const light = packet.getNumber(NumberFormat.UInt8LE, 8)
    const buttons = packet.getNumber(NumberFormat.UInt8LE, 9)
    const aPresses = packet.getNumber(NumberFormat.UInt8LE, 10)
    const rssi = radio.receivedPacket(RadioPacketProperty.SignalStrength)

    serial.writeLine(
        "{\"v\":" + PROTOCOL_VERSION +
        ",\"p\":" + player +
        ",\"s\":" + seq +
        ",\"pi\":" + pitch +
        ",\"ro\":" + roll +
        ",\"l\":" + light +
        ",\"b\":" + buttons +
        ",\"a\":" + aPresses +
        ",\"r\":" + rssi + "}"
    )

    // Blink one corner LED occasionally as an activity light.
    received++
    if (received % 20 == 0) led.toggle(4, 4)
})
