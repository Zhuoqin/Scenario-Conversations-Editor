(function (d3) {
    'use strict';
    const svg = d3.select('svg');
    const width = document.body.clientWidth;
    const height = document.body.clientHeight;

    const margin = {top: 0, right: 50, bottom: 0, left: 75};
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const treeLayout = d3.tree().size([innerHeight, innerWidth]);

    const zoomG = svg
        .attr('width', width)
        .attr('height', height)
        .append('g');

    const g = zoomG.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    svg.call(d3.zoom().on('zoom', () => {
        zoomG.attr('transform', d3.event.transform);
    }));

    d3.json('data.json')
        .then(data => {
            // console.log(data);
            const root = d3.hierarchy(data);
            // console.log(root);
            const links = treeLayout(root).links();
            // console.log(links);
            const linkPathGenerator = d3.linkVertical()
                .x(d => d.x)
                .y(d => d.y);
            g.selectAll('path').data(links)
                .enter().append('path')
                .attr('d', linkPathGenerator);

            console.log(g.selectAll('text'));

            g.selectAll('text').data(root.descendants())
                .enter().append('text')
                .attr('x', d => d.x)
                .attr('y', d => d.y)
                .attr('dy', '0.32em')
                .attr('text-anchor', d => d.children ? 'middle' : 'start')
                .attr('font-size', d => 3.25 - d.depth + 'em')
                .text(d => d.data.data.name);
        });
}(d3));
