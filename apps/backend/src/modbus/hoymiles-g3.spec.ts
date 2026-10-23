import { describe, expect, it } from 'vitest';
import {
  plausibleImage,
  setReg,
  type Image,
} from '../../test/support/synthetic.js';
import { HoymilesG3 } from './hoymiles-g3.js';
import { DETECT_BLOCKS } from './read-plan.js';
import {
  ModbusExceptionError,
  ModbusTransportError,
  type RegisterReader,
} from './readonly-modbus-client.js';

/** Serves words from an image; counts reads per block start. */
class FakeReader implements RegisterReader {
  reads = new Map<string, number>();
  constructor(
    private readonly img: Image,
    private readonly fail: (
      fc: 3 | 4,
      addr: number,
    ) => Error | undefined = () => undefined,
  ) {}
  private read(fc: 3 | 4, addr: number, len: number): Promise<number[]> {
    const k = `${fc}:${addr}`;
    this.reads.set(k, (this.reads.get(k) ?? 0) + 1);
    const err = this.fail(fc, addr);
    if (err) return Promise.reject(err);
    return Promise.resolve(
      Array.from({ length: len }, (_, i) => this.img[fc].get(addr + i) ?? 0),
    );
  }
  readInput(addr: number, len: number) {
    return this.read(4, addr, len);
  }
  readHolding(addr: number, len: number) {
    return this.read(3, addr, len);
  }
}

describe('HoymilesG3.readTier plausibility (V22)', () => {
  it('a valid 820 V / 760 V PV reading causes no retry and every block stays valid', async () => {
    const img = plausibleImage();
    setReg(img, 'pv1_voltage', 820);
    setReg(img, 'pv2_voltage', 760);
    setReg(img, 'pv1_power', 3000);
    const reader = new FakeReader(img);
    const poll = await new HoymilesG3(reader).readTier('FAST');
    expect(poll.blocks.every((b) => b.words !== null)).toBe(true);
    expect([...reader.reads.values()].every((n) => n === 1)).toBe(true);
    expect(poll.blocks[0]!.words![27]).toBe(8200);
  });

  it('PV 1100.0 V is accepted', async () => {
    const img = plausibleImage();
    setReg(img, 'pv1_voltage', 1100);
    const reader = new FakeReader(img);
    const poll = await new HoymilesG3(reader).readTier('FAST');
    expect(poll.blocks[0]!.words).not.toBeNull();
    expect(reader.reads.get('4:0')).toBe(1);
  });

  it.each([
    ['PV 1100.1 V', 'pv1_voltage', 1100.1],
    ['PV 1500 V', 'pv3_voltage', 1500],
    ['AC 650 V', 'grid_voltage_a', 650],
    ['battery 200 V', 'bat1_voltage', 200],
  ])(
    '%s is re-read twice (3 reads), then only that block is invalid',
    async (_n, key, value) => {
      const img = plausibleImage();
      setReg(img, key, value);
      const reader = new FakeReader(img);
      const poll = await new HoymilesG3(reader).readTier('FAST');
      expect(reader.reads.get('4:0')).toBe(3);
      const [b0, ...rest] = poll.blocks;
      expect(b0!.words).toBeNull();
      expect(b0!.error).toMatch(/^IMPLAUSIBLE: /);
      expect(rest.every((b) => b.words !== null)).toBe(true);
      expect(reader.reads.get('4:1800')).toBe(1);
    },
  );

  it('a block that recovers on the re-read is returned with the good words', async () => {
    const img = plausibleImage();
    setReg(img, 'battery_soc', 2005); // desynced read
    let n = 0;
    const reader: RegisterReader = {
      readInput: (addr, len) => {
        const words = Array.from(
          { length: len },
          (_, i) => img[4].get(addr + i) ?? 0,
        );
        if (addr === 1800 && ++n >= 2) words[109] = 52; // 1909 SOC repaired on 2nd read
        return Promise.resolve(words);
      },
      readHolding: () => Promise.reject(new Error('unused')),
    };
    const poll = await new HoymilesG3(reader).readTier('FAST');
    expect(poll.blocks[1]!.words).not.toBeNull();
    expect(poll.blocks[1]!.words![109]).toBe(52);
  });
});

describe('HoymilesG3 error handling', () => {
  it('a Modbus exception invalidates one block and the poll continues', async () => {
    const reader = new FakeReader(plausibleImage(), (fc, addr) =>
      addr === 2000
        ? new ModbusExceptionError(fc, addr, 123, 2, 'Illegal data address')
        : undefined,
    );
    const poll = await new HoymilesG3(reader).readTier('FAST');
    expect(poll.transportError).toBeUndefined();
    expect(poll.blocks.find((b) => b.start === 2000)!.error).toMatch(
      /MODBUS_EXCEPTION/,
    );
    expect(poll.blocks.find((b) => b.start === 30000)!.words).not.toBeNull();
    expect(reader.reads.get('4:2000')).toBe(1); // no retry on an exception
  });

  it('a transport error aborts the poll: remaining blocks are skipped, not read', async () => {
    const reader = new FakeReader(plausibleImage(), (fc, addr) =>
      addr === 1800
        ? new ModbusTransportError(fc, addr, 123, 'ETIMEDOUT')
        : undefined,
    );
    const poll = await new HoymilesG3(reader).readTier('FAST');
    expect(poll.transportError).toMatch(/TRANSPORT: .*ETIMEDOUT/);
    expect(
      poll.blocks
        .slice(2)
        .every(
          (b) =>
            b.error === 'SKIPPED_AFTER_TRANSPORT_ERROR' && b.words === null,
        ),
    ).toBe(true);
    expect(reader.reads.has('4:2000')).toBe(false);
  });
});

describe('HoymilesG3 ownership errors', () => {
  it('an error that is not a device error (e.g. lock lost) aborts the poll and is never recorded as a block', async () => {
    const reader = new FakeReader(plausibleImage(), (_fc, addr) =>
      addr === 1800 ? new Error('collector lock lost') : undefined,
    );
    await expect(new HoymilesG3(reader).readTier('FAST')).rejects.toThrow(
      /collector lock lost/,
    );
    expect(reader.reads.has('4:2000')).toBe(false);
  });
});

describe('HoymilesG3.detect', () => {
  it('reads exactly the detect_config blocks and decodes model, capabilities, firmware', async () => {
    const reader = new FakeReader(plausibleImage());
    const info = await new HoymilesG3(reader).detect();
    expect([...reader.reads.keys()]).toEqual(
      DETECT_BLOCKS.map((b) => `4:${b.start}`),
    );
    expect(info.model).toBe('HIT-10L-G3');
    expect(info.firmware).toEqual({
      powerDspVersion: 105,
      safetyDspVersion: null,
    });
    expect(info.observed).toEqual({
      hasBattery: true,
      hasGridMeter: true,
      mpptCount: 2,
      batteryCapacityKwh: 16,
    });
  });

  it('at night the MPPT count is 0 but the model and the battery/meter presence are unchanged', async () => {
    const info = await new HoymilesG3(
      new FakeReader(plausibleImage({ night: true })),
    ).detect();
    expect(info.observed.mpptCount).toBe(0);
    expect(info.model).toBe('HIT-10L-G3');
    expect(info.observed.hasBattery && info.observed.hasGridMeter).toBe(true);
  });

  it('applies the library rule: a PV voltage of exactly 1.0 V is not an MPPT, 1.1 V is', async () => {
    const img = plausibleImage({ night: true });
    setReg(img, 'pv1_voltage', 1.0);
    setReg(img, 'pv2_voltage', 1.1);
    expect(
      (await new HoymilesG3(new FakeReader(img)).detect()).observed.mpptCount,
    ).toBe(1);
  });

  it('detect fails loudly when a block is unreadable', async () => {
    const reader = new FakeReader(plausibleImage(), (fc, addr) =>
      addr === 1000
        ? new ModbusExceptionError(fc, addr, 123, 2, 'x')
        : undefined,
    );
    await expect(new HoymilesG3(reader).detect()).rejects.toThrow(
      /detect block 1000 unavailable/,
    );
  });
});
