const dropTarget = document.getElementById("dropTarget");

function ignoreEvent(event) {
    event.stopPropagation();
    event.preventDefault();
}

class BitStream {
    constructor() {
        this.bytes = [];
        this.byte = 0;
        this.b = 0;
    }

    finishByte() {
        if (this.b > 0) {
            this.bytes.push(this.byte);
            this.byte = 0;
            this.b = 0;
        }
    }

    append(bit) {
        this.byte |= (bit << (this.b++));
        if (this.b >= 8) {
            this.finishByte();
        }
    }

    getBytes() {
        // TODO: Always on byte boundary, right?
        // this.finishByte();
        return this.bytes;
    }
}

// Disable other stuff
dropTarget.addEventListener("dragenter", event => ignoreEvent(event))
dropTarget.addEventListener("dragover", event => ignoreEvent(event))

// Actual drop
dropTarget.addEventListener("drop", async (event) => {
    ignoreEvent(event);

    // Get file
    const { dataTransfer } = event;
    const { files } = dataTransfer;
    const file = files[0];
    const imageBuffer = await file.arrayBuffer();
    const decodedImage = UPNG.decode(imageBuffer);
    const { width, height } = decodedImage;
    const rgba = new Uint8Array(UPNG.toRGBA8(decodedImage)[0]);

    // Process pixel data
    const bitStream = new BitStream();
    const readBitGenerator = (function* readBitInternal() {
        let index = 0;
        for (let p = 0; p < width * height; p++) {
            // Only read lower bit of RGB, but not A
            for (let c = 0; c < 4; c++, index++) {
                if (c < 3) {
                    bitStream.append(0x1 & rgba[index]);
                    yield;
                }
            }
        }

        throw "Out of data!";
    })();

    function readBit() {
        readBitGenerator.next();
    }

    function readByte() {
        for (let i = 0; i < 8; i++) {
            readBit();
        }
        const bytes = bitStream.getBytes();
        return bytes[bytes.length - 1];
    }

    function readInt() {
        return readByte()
            | (readByte() << 8)
            | (readByte() << 16)
            | (readByte() << 24)
        ;
    }

    // Read data size and checksum
    const byteCount = readInt();
    const checksum = readInt();

    // TODO: Don't bother with checksum calculation
    // let cl = 0;
    // let ch = 0;
    // while (((ch << 8) | cl) !== checksum) {
    //     cl = (cl + readByte()) % 255;
    //     ch = (ch + cl) % 255;
    // }

    // Read compressed data
    const compressed = new Uint8Array(byteCount);
    for (let i = 0; i < byteCount; i++) {
        compressed[i] = readByte();
    }

    // Decompress
    const reader = (new Blob([compressed], { type: "application/octet-stream" })).stream().pipeThrough(new DecompressionStream("deflate")).getReader();

    const chunks = [];
    let decompressedBytes = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
        decompressedBytes += value.byteLength;
    }

    const data = new Uint8Array(decompressedBytes)
    let offset = 0;
    for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
    }

    let dataIndex = 0;
    function readDataByte() {
        return data[dataIndex++];
    }

    function readDataInt() {
        return readDataByte()
            | (readDataByte() << 8)
            | (readDataByte() << 16)
            | (readDataByte() << 24)
        ;
    }

    function readDataString() {
        const length = readDataInt();
        let result = "";
        for (let i = 0; i < length; i++) {
            // TODO: What encoding? ASCII only?
            result += String.fromCharCode(readDataByte());
        }
        return result;
    }

    readDataInt(); // Unknown
    const level = readDataString();
    const solutionName = readDataString();
    readDataInt(); // Unknown
    const solutionLength = readDataInt(); // Not used?
    readDataInt(); // Unknown
    const exaCount = readDataInt();

    const exas = [];
    for (let i = 0; i < exaCount; i++) {
        readDataByte(); // Unknown
        const name = readDataString();
        const code = readDataString();
        readDataByte(); // Code view mode
        const mode = readDataByte();

        let image = [];
        let defaultImage = 0;
        for (let row = 0; row < 10; row++) {
            const line = [];
            for (let column = 0; column < 10; column++) {
                line[column] = readDataByte();
                defaultImage |= line[column];
            }
            image[row] = line;
        }

        if (defaultImage === 0) {
            image = undefined;
        }

        exas.push({
            name,
            mode,
            ...(image ? {image} : {}),
            code,
        });
    }

    const solution = {
        name: solutionName,
        level,
        exas,
    };

    document.getElementById("exa").value =
`; ===== ${solutionName} =====

${exas.map(exa =>
`; ==== ${exa.name} (MODE: ${exa.mode ? "L" : "G"}) ====${exa.image ? ("\n" + exa.image.map(line => `; ${line.join("")}`).join("\n")) : ""}
${exa.code}
`).join("\n")}
`;

    document.getElementById("json").value = JSON.stringify(solution, null, 4);
});
